#!/usr/bin/env bats
# Behavioral tests for pr-cleanup-review-branches.sh against a throwaway local
# remote. Branch names follow what pr-create-for-review.sh creates:
#   review/<8-hex-id>-YYYY-MM-DD-(target|source)

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup
  export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid
  export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
  SCRIPT="$PROJECT_ROOT/tools/scripts/pr-cleanup-review-branches.sh"
  REMOTE="$TEST_TEMP_DIR/remote.git"
  WORK="$TEST_TEMP_DIR/work"
  git init -q --bare "$REMOTE"
  git clone -q "$REMOTE" "$WORK" 2>/dev/null
  git -C "$WORK" checkout -q -B master
  git -C "$WORK" commit -q --allow-empty -m "base"
  git -C "$WORK" push -q origin master
  TODAY="$(date +%Y-%m-%d)"
}

teardown() {
  test_helper_teardown
}

# Create a branch on the remote.
make_remote_branch() {
  git -C "$WORK" push -q origin "master:refs/heads/$1"
}

remote_has() {
  git -C "$REMOTE" show-ref --verify --quiet "refs/heads/$1"
}

@test "deletes old review branches in the real naming format and keeps recent ones" {
  make_remote_branch "review/a1b2c3d4-2020-01-15-target"
  make_remote_branch "review/a1b2c3d4-2020-01-15-source"
  make_remote_branch "review/e5f6a7b8-${TODAY}-target"
  run bash "$SCRIPT" "$WORK" 30
  [ "$status" -eq 0 ]
  run ! remote_has "review/a1b2c3d4-2020-01-15-target"
  run ! remote_has "review/a1b2c3d4-2020-01-15-source"
  remote_has "review/e5f6a7b8-${TODAY}-target"
}

@test "a branch whose name only looks date-like is never deleted, and the run fails loudly" {
  # The date used to be pulled out with an unanchored grep, so the issue number
  # and day in this name read as the date 2024-11-30 and the branch was deleted.
  make_remote_branch "review/issue-24-11-30"
  run bash "$SCRIPT" "$WORK" 30
  [ "$status" -ne 0 ]
  remote_has "review/issue-24-11-30"
  [[ "$output" == *"review/issue-24-11-30"* ]]
  [[ "$output" == *"not a recognized review branch name"* ]]
}

@test "a name with two date-like parts is refused, not guessed at" {
  make_remote_branch "review/a1b2c3d4-2020-01-15-2024-11-30-target"
  run bash "$SCRIPT" "$WORK" 30
  [ "$status" -ne 0 ]
  remote_has "review/a1b2c3d4-2020-01-15-2024-11-30-target"
  [[ "$output" == *"not a recognized review branch name"* ]]
}

@test "an impossible date is refused without aborting the rest of the cleanup" {
  make_remote_branch "review/a1b2c3d4-2020-13-45-target"
  make_remote_branch "review/b2c3d4e5-2020-01-15-target"
  run bash "$SCRIPT" "$WORK" 30
  [ "$status" -ne 0 ]
  [[ "$output" == *"review/a1b2c3d4-2020-13-45-target carries an invalid date"* ]]
  remote_has "review/a1b2c3d4-2020-13-45-target"
  # The valid old branch is still cleaned up (a bad date must not abort the run).
  run ! remote_has "review/b2c3d4e5-2020-01-15-target"
}

@test "--dry-run prints the deletion plan and deletes nothing" {
  make_remote_branch "review/a1b2c3d4-2020-01-15-target"
  make_remote_branch "review/e5f6a7b8-${TODAY}-target"
  run bash "$SCRIPT" --dry-run "$WORK" 30
  [ "$status" -eq 0 ]
  [[ "$output" == *"Would delete remote branch review/a1b2c3d4-2020-01-15-target"* ]]
  [[ "$output" != *"Would delete remote branch review/e5f6a7b8-${TODAY}-target"* ]]
  remote_has "review/a1b2c3d4-2020-01-15-target"
  remote_has "review/e5f6a7b8-${TODAY}-target"
}

@test "--dry-run is accepted after the positional arguments too" {
  make_remote_branch "review/a1b2c3d4-2020-01-15-target"
  run bash "$SCRIPT" "$WORK" 30 --dry-run
  [ "$status" -eq 0 ]
  remote_has "review/a1b2c3d4-2020-01-15-target"
}

@test "an unknown option is an error, not a repository path" {
  run bash "$SCRIPT" --dry-rn "$WORK"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Unknown option"*"--dry-rn"* ]]
}

@test "a non-numeric day count is rejected before anything is touched" {
  make_remote_branch "review/a1b2c3d4-2020-01-15-target"
  run bash "$SCRIPT" "$WORK" thirty
  [ "$status" -eq 2 ]
  remote_has "review/a1b2c3d4-2020-01-15-target"
}
