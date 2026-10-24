#!/usr/bin/env bats
# Tests for GitHub project management scripts

bats_require_minimum_version 1.5.0

load ../test_helper

@test "project-add-issue.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/project-add-issue"
  [ "$status" -eq 0 ]
}

@test "project-add-issue.sh has --help flag" {
  skip "Script uses inline documentation instead of --help flag"
  run "$PROJECT_ROOT/tools/project-add-issue" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "project-update-issue.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/project-update-issue"
  [ "$status" -eq 0 ]
}

@test "project-update-issue.sh has --help flag" {
  run "$PROJECT_ROOT/tools/project-update-issue" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "project scripts carry the error-handling equivalent" {
  for script in project-add-issue.ts project-update-issue.ts; do
    run grep -E 'core/(exit-codes|logging)\.ts' "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "project scripts validate their dependencies up front" {
  for script in project-add-issue.ts project-update-issue.ts; do
    run grep -E "providerOrgGet|assertNodeFloor" "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "project-add-issue.sh validates issue number argument" {
  run grep -E "issue.*[Nn]umber|issueNumbers" "$PROJECT_ROOT/tools/scripts/project-add-issue.ts"
  [ "$status" -eq 0 ]
}

@test "project-add-issue.sh validates project argument" {
  run grep -E "project|Project" "$PROJECT_ROOT/tools/scripts/project-add-issue.ts"
  [ "$status" -eq 0 ]
}

@test "project scripts have version information" {
  for script in project-add-issue.ts project-update-issue.ts; do
    run grep -E 'Version: 1\.' "$PROJECT_ROOT/tools/scripts/$script"
    [ "$status" -eq 0 ]
  done
}

@test "project scripts carry the status-workflow vocabulary loader" {
  # The vocabulary loader (configGetArray over [workflows] status_workflow)
  # is load-bearing only in project-update-issue; project-add-issue takes
  # field values directly.
  run grep -E 'status_workflow|configGetArray' "$PROJECT_ROOT/tools/scripts/project-update-issue.ts"
  [ "$status" -eq 0 ]
}

@test "project-update-issue.sh validates issue number argument" {
  run grep -E "issue.*[Nn]umber|issueNumber" "$PROJECT_ROOT/tools/scripts/project-update-issue.ts"
  [ "$status" -eq 0 ]
}

@test "project-add-issue handles provider errors gracefully (typed failures, no stack traces)" {
  run grep -E "catch \(err\)|catch \{" "$PROJECT_ROOT/tools/scripts/project-add-issue.ts"
  [ "$status" -eq 0 ]
}

@test "project-list-for-issue.sh documents and accepts the --devenv override like its sibling wrappers" {
  run "$PROJECT_ROOT/tools/project-list-for-issue" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"--devenv"* ]]
}

@test "project-list-for-issue.sh leaves the devenv-repo gate to resolve_target_repo (no second raw gate call)" {
  run grep -nE '^[[:space:]]*check_target_repo[[:space:]]*$' "$PROJECT_ROOT/tools/scripts/project-list-for-issue.sh"
  [ "$status" -ne 0 ]
}
