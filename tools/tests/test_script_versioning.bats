#!/usr/bin/env bats
# Tests for script version headers and versioning library integration

bats_require_minimum_version 1.5.0

load test_helper

@test "bootstrap.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "versioning library is present" {
  [ -f "$PROJECT_ROOT/tools/lib/versioning.bash" ]
}

@test "versioning library has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/lib/versioning.bash"
  [ "$status" -eq 0 ]
}

@test "versioning library defines script_version function" {
  run grep "script_version()" "$PROJECT_ROOT/tools/lib/versioning.bash"
  [ "$status" -eq 0 ]
}

@test "versioning library defines check_environment_requirements function" {
  run grep "check_environment_requirements()" "$PROJECT_ROOT/tools/lib/versioning.bash"
  [ "$status" -eq 0 ]
}

@test "versioning library defines MIN_BASH_VERSION" {
  run grep "readonly MIN_BASH_VERSION=" "$PROJECT_ROOT/tools/lib/versioning.bash"
  [ "$status" -eq 0 ]
}

@test "versioning library defines MIN_GIT_VERSION" {
  run grep "readonly MIN_GIT_VERSION=" "$PROJECT_ROOT/tools/lib/versioning.bash"
  [ "$status" -eq 0 ]
}

@test "repo-bump-version.sh sources error-handling library" {
  run grep "source.*lib/error-handling.bash" "$PROJECT_ROOT/tools/scripts/repo-bump-version.sh"
  [ "$status" -eq 0 ]
}

@test "repo-bump-version.sh sources git-config library" {
  run grep "source.*lib/git-config.bash" "$PROJECT_ROOT/tools/scripts/repo-bump-version.sh"
  [ "$status" -eq 0 ]
}

@test "version display works with SHOW_VERSION=1" {
  run bash -c "export SHOW_VERSION=1 && source $PROJECT_ROOT/tools/lib/versioning.bash && script_version 'test.sh' '1.0.0' 'Test script'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "test.sh version 1.0.0" ]]
}

@test "repo-calc-version.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/repo-calc-version.sh"
  [ "$status" -eq 0 ]
}

@test "repo-calc-version.sh sources release-operations library" {
  run grep "source.*release-operations.bash" "$PROJECT_ROOT/tools/scripts/repo-calc-version.sh"
  [ "$status" -eq 0 ]
}

@test "pr-complete-merge.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/pr-complete-merge.sh"
  [ "$status" -eq 0 ]
}

@test "pr-complete-merge.sh has set -euo pipefail" {
  run grep "set -euo pipefail" "$PROJECT_ROOT/tools/scripts/pr-complete-merge.sh"
  [ "$status" -eq 0 ]
}

@test "create-script.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/create-script.sh"
  [ "$status" -eq 0 ]
}

@test "create-script.sh references template file" {
  run grep "template" "$PROJECT_ROOT/tools/scripts/create-script.sh"
  [ "$status" -eq 0 ]
}
