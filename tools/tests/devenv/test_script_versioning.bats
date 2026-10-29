#!/usr/bin/env bats
# Tests for script version headers and versioning library integration

bats_require_minimum_version 1.5.0

load ../test_helper

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

@test "repo-bump-version carries the error-handling equivalent" {
  run grep "core/exit-codes.ts" "$PROJECT_ROOT/tools/ts/repo-bump-version.ts"
  [ "$status" -eq 0 ]
}

@test "repo-bump-version carries the git equivalent (repo-get + core spawn)" {
  run grep "repo-get" "$PROJECT_ROOT/tools/ts/repo-bump-version.ts"
  [ "$status" -eq 0 ]
}

@test "repo-calc-version.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/repo-calc-version"
  [ "$status" -eq 0 ]
}

@test "repo-calc-version carries the release version module" {
  run grep "domain/release/version.ts" "$PROJECT_ROOT/tools/ts/repo-calc-version.ts"
  [ "$status" -eq 0 ]
}

@test "tooling-create-script.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/tools/tooling-create-script"
  [ "$status" -eq 0 ]
}

@test "tooling-create-script.sh references template file" {
  run grep "template" "$PROJECT_ROOT/tools/ts/tooling-create-script.ts"
  [ "$status" -eq 0 ]
}
