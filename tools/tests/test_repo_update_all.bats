#!/usr/bin/env bats
# Tests for scripts/repo-update-all.sh

bats_require_minimum_version 1.5.0

load test_helper

@test "repo-update-all.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/repo-update-all.sh"
  [ "$status" -eq 0 ]
}

@test "repo-update-all.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/repo-update-all.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ Usage: ]]
  [[ "$output" =~ parallel ]]
}

@test "repo-update-all.sh documents --jobs option" {
  run bash "$PROJECT_ROOT/tools/scripts/repo-update-all.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ --jobs ]]
}

@test "repo-update-all.sh defines parallel job constants" {
  run grep "readonly MAX_PARALLEL_JOBS" "$PROJECT_ROOT/tools/scripts/repo-update-all.sh"
  [ "$status" -eq 0 ]
  run grep "readonly DEFAULT_PARALLEL_JOBS" "$PROJECT_ROOT/tools/scripts/repo-update-all.sh"
  [ "$status" -eq 0 ]
}

@test "repo-update-all.sh uses xargs -P for parallelism" {
  run grep "xargs -P" "$PROJECT_ROOT/tools/scripts/repo-update-all.sh"
  [ "$status" -eq 0 ]
}

@test "repo-update-all.sh exports update_single_repo" {
  run grep "export -f update_single_repo" "$PROJECT_ROOT/tools/scripts/repo-update-all.sh"
  [ "$status" -eq 0 ]
}

@test "repo-update-all.sh validates --jobs argument" {
  run bash "$PROJECT_ROOT/tools/scripts/repo-update-all.sh" --jobs abc 2>&1
  [ "$status" -ne 0 ]
  [[ "$output" =~ ERROR ]]
}

@test "repo-update-all.sh handles unknown options" {
  run bash "$PROJECT_ROOT/tools/scripts/repo-update-all.sh" --invalid-option 2>&1
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Unknown option" ]]
}
