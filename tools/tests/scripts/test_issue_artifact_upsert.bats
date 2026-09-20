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

  run bash -c 'exec 0</dev/null; "$0" "$@"' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
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

  run bash -c 'exec 0</dev/null; "$0" "$@"' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --body $'<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:org/repo:issue-42:spike:test\n-->'

  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.action')" = "updated" ]
  [ "$(echo "$output" | jq -r '.comment_id')" = "333" ]
}

@test "indented metadata header creates comment" {
  export MOCK_COMMENTS_JSON='[]'

  run bash -c 'exec 0</dev/null; "$0" "$@"' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --body $'<!-- DEVENV_ARTIFACT_V1\n doc_id: dv1:org/repo:issue-42:spike:test\n artifact_type: spike\n-->'

  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.action')" = "created" ]
  [ "$(echo "$output" | jq -r '.comment_id')" = "9001" ]
}

@test "two existing doc_id matches returns conflict with IDs" {
  export MOCK_COMMENTS_JSON='[
    {"id": 101, "html_url": "https://example.test/issues/42#issuecomment-101", "body": "doc_id: dv1:org/repo:issue-42:spike:test"},
    {"id": 202, "html_url": "https://example.test/issues/42#issuecomment-202", "body": "doc_id: dv1:org/repo:issue-42:spike:test"}
  ]'

  run bash -c 'exec 0</dev/null; "$0" "$@"' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --body $'doc_id: dv1:org/repo:issue-42:spike:test'

  [ "$status" -eq 3 ]
  [ "$(echo "$output" | jq -r '.action')" = "conflict" ]
  [ "$(echo "$output" | jq -r '.matches | join(",")')" = "101,202" ]
}

@test "same issue different doc_id creates separate comment" {
  export MOCK_COMMENTS_JSON='[
    {"id": 300, "html_url": "https://example.test/issues/42#issuecomment-300", "body": "doc_id: dv1:org/repo:issue-42:spike:other"}
  ]'

  run bash -c 'exec 0</dev/null; "$0" "$@"' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
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

  run bash -c 'exec 0</dev/null; "$0" "$@"' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --body $'doc_id: dv1:org/repo:issue-42:spike:test'

  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.action')" = "created" ]
}

@test "issue number is inferred from doc_id when no explicit issue metadata is present" {
  export MOCK_COMMENTS_JSON='[]'

  run bash -c 'exec 0</dev/null; "$0" "$@"' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --body $'<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:org/repo:issue-42:spike:test\n-->'

  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.action')" = "created" ]
  [ "$(echo "$output" | jq -r '.issue_number')" = "42" ]
}

@test "dry-run shows intended action without write" {
  export MOCK_COMMENTS_JSON='[]'

  run bash -c 'exec 0</dev/null; "$0" "$@"' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --body $'doc_id: dv1:org/repo:issue-42:spike:test' \
    --dry-run

  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.action')" = "created" ]
  [ "$(echo "$output" | jq -r 'has("comment_id")')" = "false" ]
}

# ---------------------------------------------------------------------------
# Characterization tests — pin current behavior so body-source changes
# are provable deltas. Flipped, not deleted.
# ---------------------------------------------------------------------------

@test "characterization: upsert fails with exit 2 when no comment source is provided" {
  export MOCK_COMMENTS_JSON='[]'

  # stdin is isolated from the bats TTY: with no source flag and non-TTY
  # stdin the tool auto-reads, gets EOF, and errors on the empty body.
  run bash -c 'exec 0</dev/null; "$0" "$@"' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" --issue 42

  [ "$status" -eq 2 ]
  [[ "$output" == *"Refusing empty stdin body"* ]]
}

@test "characterization: upsert --body-file reads body from file (dry-run)" {
  export MOCK_COMMENTS_JSON='[]'
  printf '<!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:org/repo:issue-42:plan:filetest\nartifact_type: plan\nissue_number: 42\n-->\n\nbody text\n' > "$TEST_TEMP_DIR/body.md"

  run bash -c 'exec 0</dev/null; "$0" "$@"' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --body-file "$TEST_TEMP_DIR/body.md" \
    --dry-run

  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.action')" = "created" ]
}

@test "characterization: upsert with both --body and --body-file exits 2" {
  export MOCK_COMMENTS_JSON='[]'
  printf 'doc_id: dv1:org/repo:issue-42:spike:test\n' > "$TEST_TEMP_DIR/body.md"

  run bash -c 'exec 0</dev/null; "$0" "$@"' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --body $'doc_id: dv1:org/repo:issue-42:spike:test' \
    --body-file "$TEST_TEMP_DIR/body.md"

  [ "$status" -eq 2 ]
  [[ "$output" == *"Only one of"* ]]
}

# ---------------------------------------------------------------------------
# Tech-debt plan F002 lock: the create path must emit comment_id and exit 0.
# ---------------------------------------------------------------------------

@test "create path emits comment_id and exits 0 (F002 lock)" {
  mkdir -p "$TEST_TEMP_DIR/bin"
  cat > "$TEST_TEMP_DIR/bin/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "auth" ]; then exit 0; fi
if [ "${1:-}" != "api" ]; then exit 0; fi
shift
method="GET"
while [ "$#" -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    -f|--raw-field) shift 2 ;;
    --paginate) shift ;;
    repos/*) endpoint="$1"; shift ;;
    *) shift ;;
  esac
done
if [ "$method" = "GET" ]; then printf '[]'; exit 0; fi
printf '{"id": 777, "html_url": "https://example.test/issues/42#issuecomment-777"}'
exit 0
GH
  chmod +x "$TEST_TEMP_DIR/bin/gh"

  run env -u GITHUB_REPO -u GH_REPO PATH="$TEST_TEMP_DIR/bin:$PATH" \
    bash -c 'exec 0</dev/null; "$0" "$@"' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --body $'doc_id: dv1:org/repo:issue-42:plan:createlock\nartifact_type: plan\nissue_number: 42'

  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.action')" = "created" ]
  [ "$(echo "$output" | jq -r '.comment_id')" = "777" ]
}

# ---------------------------------------------------------------------------
# doc_id 256-character window behavior
# ---------------------------------------------------------------------------

@test "doc_id just inside the 256-char window is accepted" {
  # pad = 250 chars after the doc_id line, so "doc_id: ..." starts at char 1
  # and the full metadata line is well inside the first 256 characters.
  local pad
  pad=$(printf 'p%.0s' $(seq 1 200))
  export MOCK_COMMENTS_JSON='[]'

  run bash -c 'exec 0</dev/null; "$0" "$@"' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --body "doc_id: dv1:org/repo:issue-42:spike:test\n${pad}"

  [ "$status" -eq 0 ]
  [ "$(echo "$output" | jq -r '.action')" = "created" ]
}

@test "doc_id beyond the 256-char window is rejected" {
  # 300 chars of padding BEFORE the doc_id line pushes it out of the window.
  local pad
  pad=$(printf 'p%.0s' $(seq 1 300))
  export MOCK_COMMENTS_JSON='[]'

  run bash -c 'exec 0</dev/null; "$0" "$@"' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh" \
    --issue 42 \
    --body "${pad}\ndoc_id: dv1:org/repo:issue-42:spike:test"

  [ "$status" -eq 2 ]
  [[ "$output" == *"256"* ]]
}
