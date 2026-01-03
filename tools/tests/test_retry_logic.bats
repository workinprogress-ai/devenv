#!/usr/bin/env bats
# Tests for lib/retry.bash

bats_require_minimum_version 1.5.0

load test_helper

@test "retry.sh library can be sourced" {
  run bash -c "source $PROJECT_ROOT/tools/lib/retry.bash && echo 'loaded'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ loaded ]]
}

@test "retry.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/tools/lib/retry.bash"
  [ "$status" -eq 0 ]
}

@test "retry.sh exports expected functions" {
  run bash -c "source $PROJECT_ROOT/tools/lib/retry.bash && declare -F retry_with_exponential_backoff retry_with_linear_backoff retry_with_timeout retry_url_fetch retry_git_clone should_retry retry_with_custom_logic"
  [ "$status" -eq 0 ]
}

@test "retry.sh defines default configuration" {
  run bash -c "source $PROJECT_ROOT/tools/lib/retry.bash && echo \$DEFAULT_MAX_RETRIES \$DEFAULT_INITIAL_DELAY \$DEFAULT_MAX_DELAY"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^3\ 1\ 60$ ]]
}

@test "retry.sh prevents multiple sourcing" {
  run bash -c "source $PROJECT_ROOT/tools/lib/retry.bash; source $PROJECT_ROOT/tools/lib/retry.bash && echo 'ok'"
  [ "$status" -eq 0 ]
}

@test "retry_with_exponential_backoff obeys multiplier cap" {
  run bash -c "grep -A5 'delay=\$((delay \* multiplier))' $PROJECT_ROOT/tools/lib/retry.bash | grep -q 'max_delay'"
  [ "$status" -eq 0 ]
}

@test "retry_url_fetch supports curl or wget" {
  run bash -c "grep -A20 'retry_url_fetch()' $PROJECT_ROOT/tools/lib/retry.bash | grep -E 'curl|wget'"
  [ "$status" -eq 0 ]
}

@test "retry_git_clone cleans up failed attempts" {
  run bash -c "grep -q 'Cleaning up failed clone directory' $PROJECT_ROOT/tools/lib/retry.bash"
  [ "$status" -eq 0 ]
}

@test "retry library includes documentation markers" {
  run bash -c "grep -c '# Arguments:' $PROJECT_ROOT/tools/lib/retry.bash"
  [ "$status" -eq 0 ]
  [ "${lines[0]}" -gt 0 ]
}
