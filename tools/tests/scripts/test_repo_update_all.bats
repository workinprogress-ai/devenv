#!/usr/bin/env bats
# Tests for scripts/repo-update-all.sh

bats_require_minimum_version 1.5.0

load ../test_helper

@test "repo-update-all.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/repo-update-all"
  [ "$status" -eq 0 ]
}

@test "repo-update-all.sh has --help flag" {
  run "$PROJECT_ROOT/tools/repo-update-all" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ Usage: ]]
  [[ "$output" =~ parallel ]]
}

@test "repo-update-all.sh documents --jobs option" {
  run "$PROJECT_ROOT/tools/repo-update-all" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ --jobs ]]
}

@test "repo-update-all defines parallel job constants" {
  run grep "MAX_PARALLEL_JOBS" "$PROJECT_ROOT/tools/ts/repo-update-all.ts"
  [ "$status" -eq 0 ]
  run grep "DEFAULT_PARALLEL_JOBS" "$PROJECT_ROOT/tools/ts/repo-update-all.ts"
  [ "$status" -eq 0 ]
}

@test "repo-update-all runs updates in parallel (spawn pool, the xargs -P analogue)" {
  run grep "updateSingleRepo" "$PROJECT_ROOT/tools/ts/repo-update-all.ts"
  [ "$status" -eq 0 ]
  run grep "parallelJobs" "$PROJECT_ROOT/tools/ts/repo-update-all.ts"
  [ "$status" -eq 0 ]
}

@test "repo-update-all.sh validates --jobs argument" {
  run "$PROJECT_ROOT/tools/repo-update-all" --jobs abc 2>&1
  [ "$status" -ne 0 ]
  [[ "$output" =~ ERROR ]]
}

@test "repo-update-all.sh handles unknown options" {
  run "$PROJECT_ROOT/tools/repo-update-all" --invalid-option 2>&1
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Unknown option" ]]
}
