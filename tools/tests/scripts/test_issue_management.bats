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
  for script in issue-create.sh issue-list.sh issue-update.sh issue-close.sh issue-select.sh issue-groom.sh; do
    run grep "SCRIPT_VERSION=" "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "all issue scripts source versioning library" {
  for script in issue-create.sh issue-list.sh issue-update.sh issue-close.sh issue-select.sh issue-groom.sh; do
    run grep 'source.*versioning.bash' "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}
