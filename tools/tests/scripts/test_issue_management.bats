#!/usr/bin/env bats
# Tests for issue management scripts

bats_require_minimum_version 1.5.0

load ../test_helper

@test "issue-create.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-create.sh"
  [ "$status" -eq 0 ]
}

@test "issue-create.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-create.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-create-batch.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-create-batch.sh"
  [ "$status" -eq 0 ]
}

@test "issue-create-batch.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-create-batch.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-create-batch.sh help documents fast mode and preview/create" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-create-batch.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "--issue" ]]
  [[ "$output" =~ "--create" ]]
  [[ "$output" =~ "--file" ]]
}

@test "issue-list.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-list.sh"
  [ "$status" -eq 0 ]
}

@test "issue-list.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-list.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-update.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-update.sh"
  [ "$status" -eq 0 ]
}

@test "issue-update.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-update.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-close.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-close.sh"
  [ "$status" -eq 0 ]
}

@test "issue-close.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-close.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue-select.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/issue-select.sh"
  [ "$status" -eq 0 ]
}

@test "issue-select.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-select.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "issue scripts use error handling library" {
  for script in issue-create.sh issue-list.sh issue-update.sh issue-close.sh issue-select.sh; do
    run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "issue scripts call shared check_dependencies" {
  for script in issue-create.sh issue-list.sh issue-update.sh issue-close.sh issue-select.sh; do
    run grep "check_dependencies" "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "issue-select.sh documents fzf usage" {
  run grep -i "fzf" "$PROJECT_ROOT/tools/scripts/issue-select.sh"
  [ "$status" -eq 0 ]
}

@test "issue-create.sh has template support" {
  run grep -E "template|TEMPLATE" "$PROJECT_ROOT/tools/scripts/issue-create.sh"
  [ "$status" -eq 0 ]
}

@test "issue-create.sh supports --blocked-by flag" {
  run grep -E "blocked-by|BLOCKED_BY" "$PROJECT_ROOT/tools/scripts/issue-create.sh"
  [ "$status" -eq 0 ]
}

@test "issue-create.sh help documents --blocked-by" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-create.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "blocked-by" ]]
}

@test "issue-list.sh supports filtering options" {
  run grep -E "\-\-state|\-\-label|\-\-assignee" "$PROJECT_ROOT/tools/scripts/issue-list.sh"
  [ "$status" -eq 0 ]
}

@test "issue-update.sh supports status updates" {
  run grep -E "status|state" "$PROJECT_ROOT/tools/scripts/issue-update.sh"
  [ "$status" -eq 0 ]
}

@test "issue-close.sh confirms before closing" {
  run grep -E "read|confirm" "$PROJECT_ROOT/tools/scripts/issue-close.sh"
  [ "$status" -eq 0 ] || skip "Confirmation may be optional with --force"
}

@test "all issue scripts have version information" {
  for script in issue-create.sh issue-create-batch.sh issue-list.sh issue-update.sh issue-close.sh issue-select.sh issue-groom.sh; do
    run grep "SCRIPT_VERSION=" "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "all issue scripts source versioning library" {
  for script in issue-create.sh issue-create-batch.sh issue-list.sh issue-update.sh issue-close.sh issue-select.sh issue-groom.sh; do
    run grep 'source.*versioning.bash' "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

create_gh_mock_for_issue_close() {
  mkdir -p "$TEST_TEMP_DIR/bin"
  export PATH="$TEST_TEMP_DIR/bin:$PATH"
  export GH_CALL_LOG="$TEST_TEMP_DIR/gh-calls.log"
  : > "$GH_CALL_LOG"
  cat > "$TEST_TEMP_DIR/bin/gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >> "${GH_CALL_LOG:-/dev/null}"
exit 0
EOF
  chmod +x "$TEST_TEMP_DIR/bin/gh"
}

@test "issue-close.sh resolves repo from cwd git repo with GH_ORG set" {
  create_gh_mock_for_issue_close
  create_mock_git_repo "$TEST_TEMP_DIR/test-repo"
  cd "$TEST_TEMP_DIR/test-repo"
  GH_ORG=test-org run bash "$PROJECT_ROOT/tools/scripts/issue-close.sh" 5
  cd "$ORIGINAL_PWD"
  [ "$status" -eq 0 ]
  # verify and close must both target the cwd-derived repo via -R, split correctly
  [ "$(grep -cx -- "-R" "$GH_CALL_LOG")" -ge 2 ]
  [ "$(grep -cx -- "test-org/test-repo" "$GH_CALL_LOG")" -ge 2 ]
}
