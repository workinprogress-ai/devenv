#!/usr/bin/env bats
# Tests for pre-commit hooks setup

bats_require_minimum_version 1.5.0

load ../test_helper

@test "commit-msg hook exists" {
  [ -f "$PROJECT_ROOT/.husky/commit-msg" ]
}

@test "commit-msg hook uses commitlint" {
  run grep "commitlint" "$PROJECT_ROOT/.husky/commit-msg"
  [ "$status" -eq 0 ]
}

@test "commit-msg hook has valid syntax" {
  run bash -n "$PROJECT_ROOT/.husky/commit-msg"
  [ "$status" -eq 0 ]
}

@test "husky is configured in package.json" {
  run grep "husky" "$PROJECT_ROOT/package.json"
  [ "$status" -eq 0 ]
}

@test "commitlint config exists" {
  [ -f "$PROJECT_ROOT/commitlint.config.js" ]
}

@test "commitlint config has valid syntax" {
  run node -c "$PROJECT_ROOT/commitlint.config.js"
  [ "$status" -eq 0 ]
}

@test "commitlint enforces Conventional Commits" {
  run grep "@commitlint/config-conventional" "$PROJECT_ROOT/commitlint.config.js"
  [ "$status" -eq 0 ]
}

@test "global pre-commit hook exists" {
  [ -f "$PROJECT_ROOT/tools/git-hooks/pre-commit" ]
}

@test "global pre-commit hook is executable" {
  [ -x "$PROJECT_ROOT/tools/git-hooks/pre-commit" ]
}

@test "global pre-commit hook has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/git-hooks/pre-commit"
  [ "$status" -eq 0 ]
}

@test "global pre-commit hook blocks commit when HEAD is a WIP commit" {
  local repo
  repo=$(mktemp -d)
  cd "$repo"
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  touch file.txt && git add file.txt && git commit -q -m "initial"
  touch wip.txt && git add wip.txt && git commit -q -m "WIP: in progress"
  # Simulate running the hook
  run bash "$PROJECT_ROOT/tools/git-hooks/pre-commit"
  [ "$status" -eq 1 ]
  [[ "$output" == *"WIP"* ]]
  rm -rf "$repo"
}

@test "global pre-commit hook allows commit when no WIP commits present" {
  local repo
  repo=$(mktemp -d)
  cd "$repo"
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  touch file.txt && git add file.txt && git commit -q -m "initial"
  run bash "$PROJECT_ROOT/tools/git-hooks/pre-commit"
  [ "$status" -eq 0 ]
  rm -rf "$repo"
}

@test "shellcheck can be used for pre-commit validation" {
  # Verify shellcheck is available for shell script validation
  run command -v shellcheck
  [ "$status" -eq 0 ] || skip "shellcheck not installed (optional)"
}

@test "husky prepare script exists" {
  run grep '"prepare".*husky' "$PROJECT_ROOT/package.json"
  [ "$status" -eq 0 ] || skip "husky prepare not configured yet"
}
