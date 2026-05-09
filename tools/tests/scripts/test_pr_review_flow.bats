#!/usr/bin/env bats
# Tests for legacy pr-* review-flow scripts (after --help fixes)

bats_require_minimum_version 1.5.0

load ../test_helper

@test "pr-create-for-review.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-create-for-review.sh"
  [ "$status" -eq 0 ]
}

@test "pr-create-for-review.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-create-for-review.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pr-get-review-link.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-get-review-link.sh"
  [ "$status" -eq 0 ]
}

@test "pr-get-review-link.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-get-review-link.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pr-cleanup-review-branches.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-cleanup-review-branches.sh"
  [ "$status" -eq 0 ]
}

@test "pr-cleanup-review-branches.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-cleanup-review-branches.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}
