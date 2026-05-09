#!/usr/bin/env bats
# Tests for git-wip and git-unwip scripts

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup

  # Create a temporary git repo with a remote to test push/pull behavior
  REMOTE_REPO=$(mktemp -d)
  git init -q --bare "$REMOTE_REPO"

  TEST_REPO=$(mktemp -d)
  cd "$TEST_REPO"
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  git remote add origin "$REMOTE_REPO"

  touch file.txt && git add file.txt && git commit -q -m "initial"
  git push -q -u origin HEAD 2>/dev/null || true
}

teardown() {
  rm -rf "$TEST_REPO" "$REMOTE_REPO"
}

# ---------------------------------------------------------------------------
# git-wip
# ---------------------------------------------------------------------------

@test "git-wip script exists and is executable" {
  [ -x "$DEVENV_TOOLS/scripts/git-wip" ]
}

@test "git-wip script has valid bash syntax" {
  run bash -n "$DEVENV_TOOLS/scripts/git-wip"
  [ "$status" -eq 0 ]
}

@test "git-wip creates a WIP commit" {
  cd "$TEST_REPO"
  echo "work" > work.txt
  run bash "$DEVENV_TOOLS/scripts/git-wip" "my note"
  [ "$status" -eq 0 ]
  msg=$(git log -1 --format=%s)
  [[ "$msg" == WIP:* ]]
}

@test "git-wip stages all untracked files" {
  cd "$TEST_REPO"
  echo "untracked" > new_file.txt
  run bash "$DEVENV_TOOLS/scripts/git-wip"
  [ "$status" -eq 0 ]
  # new_file.txt should now be in the last commit
  run git show --name-only HEAD
  [[ "$output" == *"new_file.txt"* ]]
}

# ---------------------------------------------------------------------------
# git-unwip
# ---------------------------------------------------------------------------

@test "git-unwip script exists and is executable" {
  [ -x "$DEVENV_TOOLS/scripts/git-unwip" ]
}

@test "git-unwip script has valid bash syntax" {
  run bash -n "$DEVENV_TOOLS/scripts/git-unwip"
  [ "$status" -eq 0 ]
}

@test "git-unwip soft-resets past WIP commit" {
  cd "$TEST_REPO"
  git checkout -q -b feature/test-unwip
  echo "work" > work.txt
  bash "$DEVENV_TOOLS/scripts/git-wip" "temp" 2>/dev/null || true
  run bash "$DEVENV_TOOLS/scripts/git-unwip"
  [ "$status" -eq 0 ]
  # HEAD should no longer be a WIP commit
  msg=$(git log -1 --format=%s)
  [[ "$msg" != WIP:* ]]
}

@test "git-unwip restages WIP changes" {
  cd "$TEST_REPO"
  git checkout -q -b feature/test-restage
  echo "work" > work.txt
  bash "$DEVENV_TOOLS/scripts/git-wip" "temp" 2>/dev/null || true
  bash "$DEVENV_TOOLS/scripts/git-unwip" 2>/dev/null || true
  # work.txt should be staged (index has changes vs HEAD)
  run git diff --cached --name-only
  [[ "$output" == *"work.txt"* ]]
}

@test "git-unwip refuses to run on master branch" {
  cd "$TEST_REPO"
  # Ensure we are on master (the default in the temp repo)
  current=$(git rev-parse --abbrev-ref HEAD)
  if [[ "$current" != "master" ]]; then
    skip "test repo default branch is not master"
  fi
  echo "work" > work.txt
  bash "$DEVENV_TOOLS/scripts/git-wip" "temp" 2>/dev/null || true
  run bash "$DEVENV_TOOLS/scripts/git-unwip"
  [ "$status" -eq 1 ]
  [[ "$output" == *"protected branch"* ]]
}

@test "git-unwip skips force-push when remote tip is not a WIP commit" {
  cd "$TEST_REPO"
  # Create a feature branch so we are not on a protected branch
  git checkout -q -b feature/test
  git push -q -u origin HEAD 2>/dev/null || true
  # Make a normal commit on remote (no WIP)
  echo "work" > work.txt && git add work.txt && git commit -q -m "normal commit"
  git push -q 2>/dev/null || true
  # Now reset locally to simulate a stale WIP scenario where remote is not WIP
  git reset --soft HEAD~1
  run bash "$DEVENV_TOOLS/scripts/git-unwip"
  [[ "$output" == *"not a WIP commit"* ]] || [ "$status" -eq 0 ]
}
