#!/usr/bin/env bats
# Tests for scripts/issue-artifact-upsert.sh

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup

  export PATH="$TEST_TEMP_DIR/bin:$PATH"
  mkdir -p "$TEST_TEMP_DIR/bin"

  cat > "$TEST_TEMP_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "auth" ] && [ "${2:-}" = "status" ]; then
  exit 0
fi

if [ "${1:-}" != "api" ]; then
  echo "unexpected gh command: $*" >&2
  exit 1
fi

shift
method="GET"
endpoint=""
body=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -R)
      shift 2
      ;;
    --paginate|--silent)
      shift
      ;;
    -X)
      method="$2"
      shift 2
      ;;
    -f|--raw-field)
      if [[ "${2:-}" == body=* ]]; then
        body="${2#body=}"
      fi
      shift 2
      ;;
    repos/*)
      endpoint="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [ "$method" = "GET" ] && [[ "$endpoint" =~ ^repos/\{owner\}/\{repo\}/issues/[0-9]+/comments$ ]]; then
  printf '%s\n' "${MOCK_COMMENTS_JSON:-[]}"
  exit 0
fi

if [ "$method" = "POST" ] && [[ "$endpoint" =~ ^repos/\{owner\}/\{repo\}/issues/[0-9]+/comments$ ]]; then
  issue_number="${endpoint#repos/{owner}/{repo}/issues/}"
  issue_number="${issue_number%/comments}"
  create_id="${MOCK_CREATE_ID:-9001}"
  create_url="${MOCK_CREATE_URL:-https://example.test/issues/$issue_number#issuecomment-$create_id}"
  printf '{"id":%s,"html_url":"%s","body":%s}\n' "$create_id" "$create_url" "$(jq -Rn --arg v "$body" '$v')"
  exit 0
fi

if [ "$method" = "PATCH" ] && [[ "$endpoint" =~ ^repos/\{owner\}/\{repo\}/issues/comments/[0-9]+$ ]]; then
  comment_id="${endpoint##*/}"
  update_url="${MOCK_UPDATE_URL:-https://example.test/issues/1#issuecomment-$comment_id}"
  printf '{"id":%s,"html_url":"%s","body":%s}\n' "$comment_id" "$update_url" "$(jq -Rn --arg v "$body" '$v')"
  exit 0
fi

echo "unexpected gh api call: method=$method endpoint=$endpoint" >&2
exit 1
EOF

  chmod +x "$TEST_TEMP_DIR/bin/gh"
}

teardown() {
  test_helper_teardown
}

@test "issue-artifact-upsert.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh"
  [ "$status" -eq 0 ]
}

@test "no existing doc_id match creates comment" {
  export MOCK_COMMENTS_JSON='[]'

  run "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --doc-id "dv1:org/repo:issue-42:spike:test" \
    --body $'<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:org/repo:issue-42:spike:test\n-->'

  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.action')" = "created" ]
  [ "$(echo "$output" | jq -r '.comment_id')" = "9001" ]
}

@test "one existing doc_id match updates same comment id" {
  export MOCK_COMMENTS_JSON='[
    {
      "id": 333,
      "html_url": "https://example.test/issues/42#issuecomment-333",
      "body": "<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:org/repo:issue-42:spike:test\nartifact_type: spike\n-->\ncontent"
    }
  ]'

  run "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --doc-id "dv1:org/repo:issue-42:spike:test" \
    --body $'<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:org/repo:issue-42:spike:test\n-->'

  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.action')" = "updated" ]
  [ "$(echo "$output" | jq -r '.comment_id')" = "333" ]
}

@test "two existing doc_id matches returns conflict with IDs" {
  export MOCK_COMMENTS_JSON='[
    {"id": 101, "html_url": "https://example.test/issues/42#issuecomment-101", "body": "doc_id: dv1:org/repo:issue-42:spike:test"},
    {"id": 202, "html_url": "https://example.test/issues/42#issuecomment-202", "body": "doc_id: dv1:org/repo:issue-42:spike:test"}
  ]'

  run "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --doc-id "dv1:org/repo:issue-42:spike:test" \
    --body $'doc_id: dv1:org/repo:issue-42:spike:test'

  [ "$status" -eq 3 ]
  [ "$(echo "$output" | jq -r '.action')" = "conflict" ]
  [ "$(echo "$output" | jq -r '.matches | join(",")')" = "101,202" ]
}

@test "same issue different doc_id creates separate comment" {
  export MOCK_COMMENTS_JSON='[
    {"id": 300, "html_url": "https://example.test/issues/42#issuecomment-300", "body": "doc_id: dv1:org/repo:issue-42:spike:other"}
  ]'

  run "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --doc-id "dv1:org/repo:issue-42:spike:test" \
    --body $'doc_id: dv1:org/repo:issue-42:spike:test'

  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.action')" = "created" ]
}

@test "similar text without exact doc_id line does not match" {
  export MOCK_COMMENTS_JSON='[
    {
      "id": 444,
      "html_url": "https://example.test/issues/42#issuecomment-444",
      "body": "metadata doc_id: dv1:org/repo:issue-42:spike:test (not exact line)"
    }
  ]'

  run "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --doc-id "dv1:org/repo:issue-42:spike:test" \
    --body $'doc_id: dv1:org/repo:issue-42:spike:test'

  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.action')" = "created" ]
}

@test "dry-run shows intended action without write" {
  export MOCK_COMMENTS_JSON='[]'

  run "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --doc-id "dv1:org/repo:issue-42:spike:test" \
    --body $'doc_id: dv1:org/repo:issue-42:spike:test' \
    --dry-run

  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.action')" = "created" ]
  [ "$(echo "$output" | jq -r 'has("comment_id")')" = "false" ]
}
