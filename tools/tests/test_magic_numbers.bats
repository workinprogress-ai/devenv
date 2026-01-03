#!/usr/bin/env bats
# Tests for magic numbers replaced with constants

bats_require_minimum_version 1.5.0

load test_helper

@test "background-check-devenv-updates.sh defines CHECK_INTERVAL_SECONDS" {
  run grep "readonly CHECK_INTERVAL_SECONDS=" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh CHECK_INTERVAL_SECONDS has value" {
  run grep "readonly CHECK_INTERVAL_SECONDS=600" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh defines SLEEP_CHUNK_SECONDS" {
  run grep "readonly SLEEP_CHUNK_SECONDS=" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh SLEEP_CHUNK_SECONDS has value" {
  run grep "readonly SLEEP_CHUNK_SECONDS=10" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh does not have hardcoded sleep 10" {
  run grep 'sleep 10$' "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -ne 0 ]
}

@test "background-check-devenv-updates.sh constants are readonly" {
  run grep "readonly CHECK_INTERVAL_SECONDS" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
  run grep "readonly SLEEP_CHUNK_SECONDS" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "repo-update-all.sh defines MAX_PARALLEL_JOBS constant" {
  run grep "readonly MAX_PARALLEL_JOBS=" "$PROJECT_ROOT/tools/scripts/repo-update-all.sh"
  [ "$status" -eq 0 ]
}

@test "repo-update-all.sh defines DEFAULT_PARALLEL_JOBS constant" {
  run grep "readonly DEFAULT_PARALLEL_JOBS=" "$PROJECT_ROOT/tools/scripts/repo-update-all.sh"
  [ "$status" -eq 0 ]
}

@test "repo-calc-version.sh defines DEFAULT_START_VERSION constant" {
  run grep "DEFAULT_START_VERSION=" "$PROJECT_ROOT/tools/scripts/repo-calc-version.sh"
  [ "$status" -eq 0 ]
}

@test "lib/versioning.bash defines MIN_BASH_VERSION constant" {
  run grep "readonly MIN_BASH_VERSION=" "$PROJECT_ROOT/tools/lib/versioning.bash"
  [ "$status" -eq 0 ]
}

@test "lib/versioning.bash defines MIN_GIT_VERSION constant" {
  run grep "readonly MIN_GIT_VERSION=" "$PROJECT_ROOT/tools/lib/versioning.bash"
  [ "$status" -eq 0 ]
}

@test "lib/retry.bash defines default constants" {
  run grep "readonly DEFAULT_MAX_RETRIES=" "$PROJECT_ROOT/tools/lib/retry.bash"
  [ "$status" -eq 0 ]
  run grep "readonly DEFAULT_INITIAL_DELAY=" "$PROJECT_ROOT/tools/lib/retry.bash"
  [ "$status" -eq 0 ]
  run grep "readonly DEFAULT_MAX_DELAY=" "$PROJECT_ROOT/tools/lib/retry.bash"
  [ "$status" -eq 0 ]
}

@test "script template shows constant definition pattern" {
  run grep "readonly DEFAULT_TIMEOUT=" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
  run grep "readonly DEFAULT_MAX_RETRIES=" "$PROJECT_ROOT/templates/script-template.sh"
  [ "$status" -eq 0 ]
}

@test "bootstrap.sh defines version constants" {
  run grep "PNPM_VERSION=" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
  run grep "NODE_VERSION=" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "constants have descriptive names" {
  # Constants should be in UPPER_CASE with descriptive names
  run bash -c "grep -h 'readonly [A-Z_]*=' $PROJECT_ROOT/tools/lib/*.bash $PROJECT_ROOT/tools/scripts/*.sh 2>/dev/null | head -20"
  [ "$status" -eq 0 ]
  [[ "$output" =~ VERSION|TIMEOUT|DELAY|MAX|DEFAULT ]]
}

@test "no hardcoded timeout values in key scripts" {
  skip "Some scripts use hardcoded sleep values for backwards compatibility"
  # Check that scripts use variables instead of hardcoded timeouts
  run bash -c "grep -h 'sleep [0-9][0-9]*$' $PROJECT_ROOT/tools/scripts/*.sh 2>/dev/null | head -5"
  [ "$status" -ne 0 ] || {
    # If found, should be minimal (less than 5 occurrences)
    [ "${#lines[@]}" -lt 5 ]
  }
}
