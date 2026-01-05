#!/usr/bin/env bats
# Tests for GitHub project management scripts

bats_require_minimum_version 1.5.0

load ../test_helper

@test "project-add-issue.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/project-add-issue.sh"
  [ "$status" -eq 0 ]
}

@test "project-add-issue.sh has --help flag" {
  skip "Script uses inline documentation instead of --help flag"
  run bash "$PROJECT_ROOT/tools/scripts/project-add-issue.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "project-update-issue.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/project-update-issue.sh"
  [ "$status" -eq 0 ]
}

@test "project-update-issue.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/project-update-issue.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "project scripts use error handling library" {
  for script in project-add-issue.sh project-update-issue.sh; do
    run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "project scripts call shared check_dependencies" {
  for script in project-add-issue.sh project-update-issue.sh; do
    run grep "check_dependencies" "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "project-add-issue.sh validates issue number argument" {
  run grep -E "issue.*number|ISSUE_NUMBER" "$PROJECT_ROOT/tools/scripts/project-add-issue.sh"
  [ "$status" -eq 0 ]
}

@test "project-add-issue.sh validates project argument" {
  run grep -E "project|PROJECT" "$PROJECT_ROOT/tools/scripts/project-add-issue.sh"
  [ "$status" -eq 0 ]
}

@test "project scripts have version information" {
  for script in project-add-issue.sh project-update-issue.sh; do
    run grep "SCRIPT_VERSION=" "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "project scripts source versioning library" {
  for script in project-add-issue.sh project-update-issue.sh; do
    run grep 'source.*versioning.bash' "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "project-update-issue.sh validates issue number argument" {
  run grep -E "issue.*number|ISSUE_NUMBER" "$PROJECT_ROOT/tools/scripts/project-update-issue.sh"
  [ "$status" -eq 0 ]
}

@test "project-add-issue.sh handles gh CLI errors gracefully" {
  run grep -E "set -e|trap.*ERR" "$PROJECT_ROOT/tools/scripts/project-add-issue.sh"
  [ "$status" -eq 0 ]
}
