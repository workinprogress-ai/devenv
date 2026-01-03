#!/usr/bin/env bats
# Tests for scripts/repo-bump-version.sh

bats_require_minimum_version 1.5.0

load test_helper

@test "repo-bump-version.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/repo-bump-version.sh"
  [ "$status" -eq 0 ]
}

@test "repo-bump-version.sh shows usage when missing args" {
  run "$PROJECT_ROOT/tools/scripts/repo-bump-version.sh" 2>&1
  [ "$status" -ne 0 ]
  [[ "$output" =~ Usage: ]]
}

@test "repo-bump-version.sh rejects invalid change types" {
  run "$PROJECT_ROOT/tools/scripts/repo-bump-version.sh" invalid repo-one 2>&1
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Invalid change-type" ]]
}

@test "repo-bump-version.sh requires repository list" {
  run bash -c "$PROJECT_ROOT/tools/scripts/repo-bump-version.sh patch < /dev/null 2>&1"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "No repositories provided" ]]
}
