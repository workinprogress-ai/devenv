#!/usr/bin/env bats
# Tests for pr-* management scripts (pr-get, pr-comment, pr-diff, pr-list)

bats_require_minimum_version 1.5.0

load ../test_helper

@test "pr-get.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-get.sh"
  [ "$status" -eq 0 ]
}

@test "pr-get.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-get.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pr-comment.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-comment.sh"
  [ "$status" -eq 0 ]
}

@test "pr-comment.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-comment.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pr-diff.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-diff.sh"
  [ "$status" -eq 0 ]
}

@test "pr-diff.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-diff.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pr-list.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-list.sh"
  [ "$status" -eq 0 ]
}

@test "pr-list.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-list.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pr scripts use error handling library" {
  for script in pr-get.sh pr-comment.sh pr-diff.sh pr-list.sh; do
    run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "pr scripts source github-helpers" {
  for script in pr-get.sh pr-comment.sh pr-diff.sh pr-list.sh; do
    run grep 'source.*github-helpers.bash' "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "pr-get rejects non-numeric PR number" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-get.sh" abc
  [ "$status" -ne 0 ]
}

@test "pr-comment rejects missing comment source" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-comment.sh" 1
  [ "$status" -ne 0 ]
}

@test "pr-diff rejects mixing PR and ref modes" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-diff.sh" 1 --base master --head feature
  [ "$status" -ne 0 ]
}

# ============================================================================
# pr-threads-get tests (task 2.8)
# ============================================================================

@test "pr-threads-get.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-threads-get.sh"
  [ "$status" -eq 0 ]
}

@test "pr-threads-get.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-threads-get.sh" --help
  [ "$status" -eq 0 ]
  [[  "$output" =~ "Usage:" ]]
}

@test "pr-threads-get.sh rejects non-numeric PR number" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-threads-get.sh" abc
  [ "$status" -ne 0 ]
}

@test "pr-threads-get.sh rejects missing PR number" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-threads-get.sh"
  [ "$status" -ne 0 ]
}

@test "pr-threads-get.sh rejects unknown option" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-threads-get.sh" 123 --not-a-flag
  [ "$status" -ne 0 ]
}

@test "pr-threads-get.sh does not send string null cursor on first page" {
  mkdir -p "$TEST_TEMP_DIR/bin"
  export PATH="$TEST_TEMP_DIR/bin:$PATH"
  export GITHUB_REPO="workinprogress-ai/example-repo"

  cat > "$TEST_TEMP_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  exit 0
fi

if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then
  # Regression guard: passing cursor="null" or cursor=null as a String
  # causes empty thread results on some PRs.
  if [[ "$*" == *"cursor=null"* ]] || [[ "$*" == *"cursor=\"null\""* ]]; then
    echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[]}}}}}'
    exit 0
  fi

  echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false,"endCursor":null},"nodes":[{"id":"thread-1","isResolved":false,"path":"src/a.cs","line":10,"startLine":10,"diffSide":"RIGHT","comments":{"nodes":[{"id":"node-1","databaseId":111,"author":{"login":"dev"},"body":"open thread","createdAt":"2026-06-06T00:00:00Z","url":"https://example.test/comment/111"}]}}]}}}}}'
    exit 0
fi

echo "unexpected gh call: $*" >&2
exit 1
EOF
  chmod +x "$TEST_TEMP_DIR/bin/gh"

  run bash "$PROJECT_ROOT/tools/scripts/pr-threads-get.sh" 29 --devenv
  [ "$status" -eq 0 ]
  json_output=$(echo "$output" | tail -n 1)
  [ "$(echo "$json_output" | jq 'length')" -eq 1 ]
}

# ============================================================================
# pr-thread-reply tests (task 2.9)
# ============================================================================

@test "pr-thread-reply.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-thread-reply.sh"
  [ "$status" -eq 0 ]
}

@test "pr-thread-reply.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-thread-reply.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pr-thread-reply.sh rejects missing comment-id" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-thread-reply.sh" 123 --body "hi"
  [ "$status" -ne 0 ]
}

@test "pr-thread-reply.sh rejects missing body source" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-thread-reply.sh" 123 --comment-id 456
  [ "$status" -ne 0 ]
}

# ============================================================================
# pr-thread-resolve tests (task 2.9)
# ============================================================================

@test "pr-thread-resolve.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-thread-resolve.sh"
  [ "$status" -eq 0 ]
}

@test "pr-thread-resolve.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-thread-resolve.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pr-thread-resolve.sh rejects missing thread ID" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-thread-resolve.sh"
  [ "$status" -ne 0 ]
}

@test "new pr-thread scripts source error-handling and github-helpers" {
  for script in pr-threads-get.sh pr-thread-reply.sh pr-thread-resolve.sh; do
    run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
    run grep 'source.*github-helpers.bash' "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}


@test "pr-list rejects invalid state" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-list.sh" --state bogus
  [ "$status" -ne 0 ]
}

@test "pr-list rejects non-numeric limit" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-list.sh" --limit abc
  [ "$status" -ne 0 ]
}
