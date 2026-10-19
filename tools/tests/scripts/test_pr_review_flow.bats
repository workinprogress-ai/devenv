#!/usr/bin/env bats
# Tests for pr-* review-flow scripts (after --help fixes)

bats_require_minimum_version 1.5.0

load ../test_helper

@test "pr-create-for-review.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/pr-create-for-review"
  [ "$status" -eq 0 ]
}

@test "pr-create-for-review.sh has --help flag" {
  run "$PROJECT_ROOT/tools/pr-create-for-review" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pr-get-review-link.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/pr-get-review-link"
  [ "$status" -eq 0 ]
}

@test "pr-get-review-link.sh has --help flag" {
  run "$PROJECT_ROOT/tools/pr-get-review-link" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "pr-cleanup-review-branches.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/pr-cleanup-review-branches"
  [ "$status" -eq 0 ]
}

@test "pr-cleanup-review-branches.sh has --help flag" {
  run "$PROJECT_ROOT/tools/pr-cleanup-review-branches" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}
