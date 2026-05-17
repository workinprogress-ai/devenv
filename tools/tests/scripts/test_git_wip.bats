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

@test "git-wip sets refs/wip/last to HEAD after pushing" {
  cd "$TEST_REPO"
  echo "work" > work.txt
  bash "$DEVENV_TOOLS/scripts/git-wip" "save" 2>/dev/null || true
  wip_ref=$(git rev-parse refs/wip/last 2>/dev/null)
  head_ref=$(git rev-parse HEAD)
  [ "$wip_ref" = "$head_ref" ]
}

@test "git-wip overwrites refs/wip/last on subsequent calls" {
  cd "$TEST_REPO"
  echo "first" > first.txt
  bash "$DEVENV_TOOLS/scripts/git-wip" "first" 2>/dev/null || true
  first_ref=$(git rev-parse refs/wip/last)

  echo "second" > second.txt
  bash "$DEVENV_TOOLS/scripts/git-wip" "second" 2>/dev/null || true
  second_ref=$(git rev-parse refs/wip/last)
  head_ref=$(git rev-parse HEAD)

  [ "$second_ref" = "$head_ref" ]
  [ "$second_ref" != "$first_ref" ]
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

# ---------------------------------------------------------------------------
# git-wip-recover
# ---------------------------------------------------------------------------

@test "git-wip-recover script exists and is executable" {
  [ -x "$DEVENV_TOOLS/scripts/git-wip-recover" ]
}

@test "git-wip-recover script has valid bash syntax" {
  run bash -n "$DEVENV_TOOLS/scripts/git-wip-recover"
  [ "$status" -eq 0 ]
}

@test "git-wip-recover fails gracefully when no ref exists" {
  cd "$TEST_REPO"
  run bash "$DEVENV_TOOLS/scripts/git-wip-recover" --show
  [ "$status" -eq 1 ]
  [[ "$output" == *"no saved WIP commit"* ]]
}

@test "git-wip-recover --show prints saved WIP commit summary" {
  cd "$TEST_REPO"
  echo "recover-me" > recover.txt
  bash "$DEVENV_TOOLS/scripts/git-wip" "recovery test" 2>/dev/null || true
  run bash "$DEVENV_TOOLS/scripts/git-wip-recover" --show
  [ "$status" -eq 0 ]
  [[ "$output" == *"Saved WIP commit"* ]]
  [[ "$output" == *"WIP: recovery test"* ]]
}

@test "git-wip-recover --branch creates a branch at the WIP commit" {
  cd "$TEST_REPO"
  echo "recover-branch" > recover2.txt
  bash "$DEVENV_TOOLS/scripts/git-wip" "branch test" 2>/dev/null || true
  wip_commit=$(git rev-parse refs/wip/last)
  # unwip so HEAD moves away from the WIP commit
  git checkout -q -b feature/recover-test
  git push -q -u origin HEAD 2>/dev/null || true
  bash "$DEVENV_TOOLS/scripts/git-unwip" 2>/dev/null || true
  # now recover into a new branch
  run bash "$DEVENV_TOOLS/scripts/git-wip-recover" --branch recovered-test
  [ "$status" -eq 0 ]
  [[ "$output" == *"recovered-test"* ]]
  recovered_tip=$(git rev-parse recovered-test)
  [ "$recovered_tip" = "$wip_commit" ]
}

@test "git-wip-recover --branch uses default name when none supplied" {
  cd "$TEST_REPO"
  echo "default-name" > default.txt
  bash "$DEVENV_TOOLS/scripts/git-wip" "default name test" 2>/dev/null || true
  git checkout -q -b feature/default-name-test
  git push -q -u origin HEAD 2>/dev/null || true
  bash "$DEVENV_TOOLS/scripts/git-unwip" 2>/dev/null || true
  run bash "$DEVENV_TOOLS/scripts/git-wip-recover" --branch
  [ "$status" -eq 0 ]
  [[ "$output" == *"wip-recovered"* ]]
}

@test "git-wip-recover refs/wip/last survives git-unwip" {
  cd "$TEST_REPO"
  git checkout -q -b feature/survive-test
  git push -q -u origin HEAD 2>/dev/null || true
  echo "survive" > survive.txt
  bash "$DEVENV_TOOLS/scripts/git-wip" "survive test" 2>/dev/null || true
  wip_commit=$(git rev-parse refs/wip/last)
  bash "$DEVENV_TOOLS/scripts/git-unwip" 2>/dev/null || true
  # ref must still exist and point to the WIP commit
  surviving_ref=$(git rev-parse refs/wip/last 2>/dev/null)
  [ "$surviving_ref" = "$wip_commit" ]
}
