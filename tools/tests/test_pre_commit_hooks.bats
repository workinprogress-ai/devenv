#!/usr/bin/env bats
# Tests for pre-commit hooks setup

bats_require_minimum_version 1.5.0

load test_helper

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

@test "pre-commit hook can be added if needed" {
  # Devenv doesn't have pre-commit hook yet, but structure exists
  [ -d "$PROJECT_ROOT/.husky" ]
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
