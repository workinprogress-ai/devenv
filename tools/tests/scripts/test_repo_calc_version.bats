#!/usr/bin/env bats
# Tests for scripts/repo-calc-version.sh

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup
  # create isolated repo for each test
  export WORK_REPO="$TEST_TEMP_DIR/repo"
  mkdir -p "$WORK_REPO"
  cd "$WORK_REPO"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "initial" > README.md
  git add README.md
  git commit -q -m "chore: initial"
}

teardown() {
  cd "$PROJECT_ROOT"
  test_helper_teardown
}

@test "repo-calc-version returns default start when no tags" {
  run bash "$PROJECT_ROOT/tools/scripts/repo-calc-version.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "1.0.0" ]
}

@test "repo-calc-version bumps patch on fix commit" {
  git tag v1.2.0
  echo "bugfix" >> README.md
  git add README.md
  git commit -q -m "fix: bug"

  run bash "$PROJECT_ROOT/tools/scripts/repo-calc-version.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "1.2.1" ]
}

@test "repo-calc-version bumps minor on feat commit" {
  git tag v1.2.0
  echo "feature" >> README.md
  git add README.md
  git commit -q -m "feat: add thing"

  run bash "$PROJECT_ROOT/tools/scripts/repo-calc-version.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "1.3.0" ]
}

@test "repo-calc-version bumps major on breaking change" {
  git tag v1.2.0
  echo "breaking" >> README.md
  git add README.md
  git commit -q -m "feat!: breaking change"

  run bash "$PROJECT_ROOT/tools/scripts/repo-calc-version.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "2.0.0" ]
}
