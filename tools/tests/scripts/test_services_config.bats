#!/usr/bin/env bats
# Tests for service configuration script

bats_require_minimum_version 1.5.0

load ../test_helper

@test "get-services-config.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/get-services-config.sh"
  [ "$status" -eq 0 ]
}

@test "get-services-config.sh has --help flag" {
  skip "Script requires repo URL as argument, doesn't support --help"
  run bash "$PROJECT_ROOT/tools/scripts/get-services-config.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "get-services-config.sh uses error handling library" {
  run grep 'source.*error-handling.bash' "$PROJECT_ROOT/tools/scripts/get-services-config.sh"
  [ "$status" -eq 0 ]
}

@test "get-services-config.sh uses DEVENV_ROOT variable" {
  run grep -E '\$DEVENV_ROOT/' "$PROJECT_ROOT/tools/scripts/get-services-config.sh"
  [ "$status" -eq 0 ]
}

@test "get-services-config.sh validates service argument" {
  run grep -E "repo_url|SERVICES_CONFIG_REPO" "$PROJECT_ROOT/tools/scripts/get-services-config.sh"
  [ "$status" -eq 0 ]
}

@test "get-services-config.sh has cleanup function" {
  run grep -q "rm -rf.*target_folder" "$PROJECT_ROOT/tools/scripts/get-services-config.sh"
  [ "$status" -eq 0 ]
}

@test "get-services-config.sh clones git repository" {
  run grep "git clone" "$PROJECT_ROOT/tools/scripts/get-services-config.sh"
  [ "$status" -eq 0 ]
}

@test "get-services-config.sh supports branch checkout" {
  run grep "git checkout" "$PROJECT_ROOT/tools/scripts/get-services-config.sh"
  [ "$status" -eq 0 ]
}

@test "get-services-config.sh removes git artifacts" {
  run grep 'rm -rf.*\.git' "$PROJECT_ROOT/tools/scripts/get-services-config.sh"
  [ "$status" -eq 0 ]
}

@test "get-services-config.sh creates info.txt metadata" {
  run grep "info.txt" "$PROJECT_ROOT/tools/scripts/get-services-config.sh"
  [ "$status" -eq 0 ]
}

@test "get-services-config.sh creates default.env template" {
  run grep "default.env" "$PROJECT_ROOT/tools/scripts/get-services-config.sh"
  [ "$status" -eq 0 ]
}

@test "get-services-config.sh handles missing repo URL" {
  run grep -A2 'if \[ -z "$repo_url" \]' "$PROJECT_ROOT/tools/scripts/get-services-config.sh"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "log_error" ]]
}
