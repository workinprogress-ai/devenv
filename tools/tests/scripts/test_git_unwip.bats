#!/usr/bin/env bats
# Tests for git-unwip target selection.
#
# Uses real temp git repos (same scaffolding as test_git_wip.bats):
# verifies the reset target is the last commit whose subject does NOT start
# with "WIP:", that subject merely containing "wip:" is never skipped, that
# a WIP-only history refuses to unwip, and the protected-branch guard.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup

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
  git checkout -q -b feature/x
}

teardown() {
  rm -rf "$TEST_REPO" "$REMOTE_REPO"
}

@test "unwip: resets to the last non-WIP commit" {
  git commit -q --allow-empty -m "fix: real work"
  git commit -q --allow-empty -m "WIP: snapshot"
  run bash "$DEVENV_TOOLS/scripts/git-unwip"
  [ "$status" -eq 0 ]
  [ "$(git log -1 --format=%s)" = "fix: real work" ]
}

@test "unwip: subject containing 'wip:' mid-message is NOT skipped" {
  git commit -q --allow-empty -m "fix: handle wip: items gracefully"
  git commit -q --allow-empty -m "WIP: snapshot"
  run bash "$DEVENV_TOOLS/scripts/git-unwip"
  [ "$status" -eq 0 ]
  [ "$(git log -1 --format=%s)" = "fix: handle wip: items gracefully" ]
}

@test "unwip: consecutive WIP commits reset past all of them" {
  git commit -q --allow-empty -m "feat: base work"
  git commit -q --allow-empty -m "WIP: a"
  git commit -q --allow-empty -m "WIP: b"
  run bash "$DEVENV_TOOLS/scripts/git-unwip"
  [ "$status" -eq 0 ]
  [ "$(git log -1 --format=%s)" = "feat: base work" ]
}

@test "unwip: refuses when every commit is a WIP commit" {
  # feature branch has only WIP commits beyond the initial (pushed) commit;
  # soft-reset past all WIPs would land on initial — that IS valid, so build
  # a repo where even root is WIP-titled: re-init without non-WIP commits.
  git checkout -q --orphan wiponly
  git commit -q --allow-empty -m "WIP: only commit"
  run bash "$DEVENV_TOOLS/scripts/git-unwip"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no non-WIP commit"* ]]
}

@test "unwip: refuses on protected branch" {
  git commit -q --allow-empty -m "WIP: snapshot"
  git checkout -q master 2>/dev/null || git checkout -q main
  run bash "$DEVENV_TOOLS/scripts/git-unwip"
  [ "$status" -eq 1 ]
  [[ "$output" == *"protected branch"* ]]
}

@test "unwip: skips force-push when remote tip is not a WIP commit" {
  git commit -q --allow-empty -m "fix: real work"
  git commit -q --allow-empty -m "WIP: snapshot"
  git push -q origin feature/x
  # Overwrite remote tip with a non-WIP commit so guard 3 fires
  git commit -q --allow-empty -m "not wip on remote"
  git push -q --force origin feature/x
  git reset -q --hard HEAD~1 2>/dev/null || true

  run bash "$DEVENV_TOOLS/scripts/git-unwip"
  [ "$status" -eq 0 ]
  [[ "$output" == *"skipping force-push"* ]]
}
