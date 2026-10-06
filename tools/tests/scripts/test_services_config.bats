#!/usr/bin/env bats
# Tests for service configuration script

bats_require_minimum_version 1.5.0

load ../test_helper

@test "get-services-config.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/scripts/get-services-config.sh"
  [ "$status" -eq 0 ]
}

@test "get-services-config.sh has --help flag" {
  run bash "$PROJECT_ROOT/tools/scripts/get-services-config.sh" --help
  [ "$status" -eq 0 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "get-services-config.sh --help leaves an existing config folder untouched" {
  # Without --help handling the flag was taken as a repo URL and the existing
  # target folder was deleted before the clone failed.
  mkdir -p "$TEST_TEMP_DIR/cfg"
  echo keep > "$TEST_TEMP_DIR/cfg/marker"
  run env CONFIG_FOLDER="$TEST_TEMP_DIR/cfg" bash "$PROJECT_ROOT/tools/scripts/get-services-config.sh" --help
  [ "$status" -eq 0 ]
  [ -f "$TEST_TEMP_DIR/cfg/marker" ]
}

@test "get-services-config.sh -h is the same as --help" {
  run bash "$PROJECT_ROOT/tools/scripts/get-services-config.sh" -h
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
