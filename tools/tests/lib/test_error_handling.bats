#!/usr/bin/env bats
# Tests for error-handling.sh library

bats_require_minimum_version 1.5.0

# Simple assert functions
assert_success() {
    if [ "$status" -ne 0 ]; then
        echo "Expected success but got status: $status"
        echo "Output: $output"
        return 1
    fi
}

assert_failure() {
    if [ "$status" -eq 0 ]; then
        echo "Expected failure but got success"
        echo "Output: $output"
        return 1
    fi
}

assert_output() {
    local flag="$1"
    local expected="$2"
    
    if [ "$flag" = "--partial" ]; then
        if [[ ! "$output" =~ $expected ]]; then
            echo "Expected output to contain: $expected"
            echo "Actual output: $output"
            return 1
        fi
    else
        if [ "$output" != "$expected" ]; then
            echo "Expected: $expected"
            echo "Actual: $output"
            return 1
        fi
    fi
}

setup() {
    export TEST_TEMP_DIR="$(mktemp -d)"
    # Handle both test locations (tests/ and tests/lib/ or tests/scripts/ or tests/devenv/)
    if [[ "$BATS_TEST_DIRNAME" =~ /tests/(lib|scripts|devenv)$ ]]; then
        export PROJECT_ROOT="$(cd "${BATS_TEST_DIRNAME}/../../.." && pwd)"
    else
        export PROJECT_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
    fi
    
    # Source the error handling library
    source "$PROJECT_ROOT/tools/lib/error-handling.bash"
}

teardown() {
    if [ -d "$TEST_TEMP_DIR" ]; then
        rm -rf "$TEST_TEMP_DIR"
    fi
}

@test "error-handling: library can be sourced" {
    run bash -c "source $PROJECT_ROOT/tools/lib/error-handling.bash && echo 'loaded'"
    assert_success
    assert_output --partial "loaded"
}

@test "error-handling: exit codes are defined" {
    run bash -c "source $PROJECT_ROOT/tools/lib/error-handling.bash && echo \$EXIT_SUCCESS"
    assert_success
    [ "$output" = "0" ]
}

@test "error-handling: log_info outputs message" {
    run bash -c "source $PROJECT_ROOT/tools/lib/error-handling.bash && log_info 'test message'"
    assert_success
    assert_output --partial "INFO"
    assert_output --partial "test message"
}

@test "error-handling: log_warn outputs warning" {
    run bash -c "source $PROJECT_ROOT/tools/lib/error-handling.bash && log_warn 'warning message'"
    assert_success
    assert_output --partial "WARN"
    assert_output --partial "warning message"
}

@test "error-handling: log_error outputs error" {
    run bash -c "source $PROJECT_ROOT/tools/lib/error-handling.bash && log_error 'error message'"
    assert_success
    assert_output --partial "ERROR"
    assert_output --partial "error message"
}

@test "error-handling: log_debug respects DEBUG flag" {
    # Default should not show debug
    run bash -c "source $PROJECT_ROOT/tools/lib/error-handling.bash && log_debug 'debug message'"
    assert_success
    [[ ! "$output" =~ "debug message" ]]
}

@test "error-handling: log_debug shows when DEBUG=1" {
    run bash -c "DEBUG=1 source $PROJECT_ROOT/tools/lib/error-handling.bash && log_debug 'debug message'"
    assert_success
    assert_output --partial "DEBUG"
    assert_output --partial "debug message"
}

@test "error-handling: timestamps are included in logs" {
    run bash -c "source $PROJECT_ROOT/tools/lib/error-handling.bash && log_info 'timestamp test'"
    assert_success
    # Check for ISO-like timestamp prefix
    assert_output --partial "\\[[0-9]{4}-[0-9]{2}-[0-9]{2}"
}

@test "error-handling: enable_strict_mode sets error handling" {
    run bash -c "source $PROJECT_ROOT/tools/lib/error-handling.bash && enable_strict_mode && echo 'strict mode enabled'"
    assert_success
    assert_output --partial "strict mode enabled"
}
