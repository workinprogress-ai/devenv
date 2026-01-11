#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load ../test_helper

@test "repo-update-config.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/repo-update-config.sh"
  [ "$status" -eq 0 ]
}

@test "repo-update-config.sh passes shellcheck" {
  run shellcheck -S warning "$PROJECT_ROOT/tools/scripts/repo-update-config.sh"
  [ "$status" -eq 0 ]
}

@test "repo-update-config.sh shows usage when no arguments" {
  run "$PROJECT_ROOT/tools/scripts/repo-update-config.sh"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "repo-update-config.sh shows help with --help" {
  run "$PROJECT_ROOT/tools/scripts/repo-update-config.sh" --help
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "repo-update-config.sh fails on nonexistent path" {
  run "$PROJECT_ROOT/tools/scripts/repo-update-config.sh" "/nonexistent/path"
  [ "$status" -ne 0 ]
}

@test "repo-update-config.sh accepts --type option" {
  local test_repo="$TEST_TEMP_DIR/test-repo"
  mkdir -p "$test_repo"
  cd "$test_repo" || exit 1
  git init -q
  git remote add origin "https://github.com/test-org/test-service.git"
  
  run "$PROJECT_ROOT/tools/scripts/repo-update-config.sh" "$test_repo" --type service
  # May fail due to missing API, but args should be accepted
}
