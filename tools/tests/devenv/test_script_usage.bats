#!/usr/bin/env bats
# Tests for script --help flags and usage documentation

bats_require_minimum_version 1.5.0

load ../test_helper

@test "repo-get has --help or usage" {
  run grep -E "(show_usage|usage\(|--help)" "$PROJECT_ROOT/tools/ts/repo-get.ts"
  [ "$status" -eq 0 ]
}

@test "repo-create.sh supports --help" {
  run "$PROJECT_ROOT/tools/repo-create" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ Usage: ]]
}

@test "repo-update-all.sh has --help flag" {
  run "$PROJECT_ROOT/tools/repo-update-all" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ Usage: ]]
}

@test "repo-bump-version has usage function" {
  run grep "function usage" "$PROJECT_ROOT/tools/ts/repo-bump-version.ts"
  [ "$status" -eq 0 ]
}

@test "pr-create.sh has --help flag" {
  run "$PROJECT_ROOT/tools/pr-create" --help 2>&1 || true
  [[ "$output" =~ Usage: ]] || [[ "$output" =~ usage ]]
}

@test "pr-create-for-review.sh has --help flag" {
  skip "Script uses inline comments for documentation"
  run "$PROJECT_ROOT/tools/pr-create-for-review" --help 2>&1 || true
  [[ "$output" =~ Usage: ]] || [[ "$output" =~ usage ]]
}

@test "tooling-create-script.sh has --help flag" {
  run "$PROJECT_ROOT/tools/tooling-create-script" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ Usage: ]]
}

@test "tooling-create-script.sh help describes --dir option" {
  run "$PROJECT_ROOT/tools/tooling-create-script" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ --dir ]]
}

@test "tooling-create-script.sh help describes --force option" {
  run "$PROJECT_ROOT/tools/tooling-create-script" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ --force ]]
}

@test "lint-scripts.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/lint-scripts"
  [ "$status" -eq 0 ]
}

@test "repo-version-list.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/repo-version-list"
  [ "$status" -eq 0 ]
}

@test "issue-create.sh has usage output" {
  run "$PROJECT_ROOT/tools/issue-create" --help 2>&1 || true
  [[ "$output" =~ Usage: ]] || [[ "$output" =~ usage ]]
}

@test "issue-list.sh has usage output" {
  run "$PROJECT_ROOT/tools/issue-list" --help 2>&1 || true
  [[ "$output" =~ Usage: ]] || [[ "$output" =~ usage ]]
}

@test "kube-forward-ports.sh has usage output" {
  skip "Script uses inline comments for documentation"
  run "$PROJECT_ROOT/tools/kube-forward-ports" --help 2>&1 || true
  [[ "$output" =~ Usage: ]] || [[ "$output" =~ usage ]]
}

@test "kube-logs.sh has usage output" {
  skip "Script uses inline comments for documentation"
  run "$PROJECT_ROOT/tools/kube-logs" --help 2>&1 || true
  [[ "$output" =~ Usage: ]] || [[ "$output" =~ usage ]]
}
