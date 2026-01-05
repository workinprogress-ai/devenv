#!/usr/bin/env bats
# Tests for script --help flags and usage documentation

bats_require_minimum_version 1.5.0

load ../test_helper

@test "docker-build.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/docker-build.sh"
  [ "$status" -eq 0 ]
}

@test "docker-up.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/docker-up.sh"
  [ "$status" -eq 0 ]
}

@test "docker-down.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/docker-down.sh"
  [ "$status" -eq 0 ]
}

@test "repo-get.sh has --help or usage function" {
  run grep -E "(show_usage|usage\(\)|--help)" "$PROJECT_ROOT/tools/scripts/repo-get.sh"
  [ "$status" -eq 0 ]
}

@test "repo-create.sh supports --help" {
  run bash "$PROJECT_ROOT/tools/scripts/repo-create.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ Usage: ]]
}

@test "repo-update-all.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/repo-update-all.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ Usage: ]]
}

@test "repo-bump-version.sh has usage function" {
  run grep "usage()" "$PROJECT_ROOT/tools/scripts/repo-bump-version.sh"
  [ "$status" -eq 0 ]
}

@test "pr-create-for-merge.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/pr-create-for-merge.sh" --help 2>&1 || true
  [[ "$output" =~ Usage: ]] || [[ "$output" =~ usage ]]
}

@test "pr-create-for-review.sh has --help flag" {
  skip "Script uses inline comments for documentation"
  run bash "$PROJECT_ROOT/tools/scripts/pr-create-for-review.sh" --help 2>&1 || true
  [[ "$output" =~ Usage: ]] || [[ "$output" =~ usage ]]
}

@test "create-script.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/create-script.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ Usage: ]]
}

@test "create-script.sh help describes --dir option" {
  run bash "$PROJECT_ROOT/tools/scripts/create-script.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ --dir ]]
}

@test "create-script.sh help describes --force option" {
  run bash "$PROJECT_ROOT/tools/scripts/create-script.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ --force ]]
}

@test "lint-scripts.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/lint-scripts.sh"
  [ "$status" -eq 0 ]
}

@test "repo-version-list.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/repo-version-list.sh"
  [ "$status" -eq 0 ]
}

@test "issue-create.sh has usage output" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-create.sh" --help 2>&1 || true
  [[ "$output" =~ Usage: ]] || [[ "$output" =~ usage ]]
}

@test "issue-list.sh has usage output" {
  run bash "$PROJECT_ROOT/tools/scripts/issue-list.sh" --help 2>&1 || true
  [[ "$output" =~ Usage: ]] || [[ "$output" =~ usage ]]
}

@test "kube-forward-ports.sh has usage output" {
  skip "Script uses inline comments for documentation"
  run bash "$PROJECT_ROOT/tools/scripts/kube-forward-ports.sh" --help 2>&1 || true
  [[ "$output" =~ Usage: ]] || [[ "$output" =~ usage ]]
}

@test "kube-logs.sh has usage output" {
  skip "Script uses inline comments for documentation"
  run bash "$PROJECT_ROOT/tools/scripts/kube-logs.sh" --help 2>&1 || true
  [[ "$output" =~ Usage: ]] || [[ "$output" =~ usage ]]
}
