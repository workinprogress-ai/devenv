#!/usr/bin/env bats
# Tests for config.sh library

bats_require_minimum_version 1.5.0

setup() {
    # Handle both test locations (tests/ and tests/lib/ or tests/scripts/ or tests/devenv/)
    if [[ "$BATS_TEST_DIRNAME" =~ /tests/(lib|scripts|devenv)$ ]]; then
        export PROJECT_ROOT="${BATS_TEST_DIRNAME}/../../.."
    else
        export PROJECT_ROOT="${BATS_TEST_DIRNAME}/../.."
    fi
    export TEST_TEMP_DIR="$(mktemp -d)"
}

teardown() {
    if [ -d "$TEST_TEMP_DIR" ]; then
        rm -rf "$TEST_TEMP_DIR"
    fi
}

@test "config: library can be sourced" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config.bash && echo loaded"
    [ "$status" -eq 0 ]
    [[ "$output" =~ loaded ]]
}

@test "config: config_set stores values and exports env" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config.bash && config_set SAMPLE_KEY sample && echo \"\$(config_get SAMPLE_KEY)-\$SAMPLE_KEY\""
    [ "$status" -eq 0 ]
    [ "$output" = "sample-sample" ]
}

@test "config: config_get returns default when unset" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config.bash && config_get MISSING_KEY default-value"
    [ "$status" -eq 0 ]
    [ "$output" = "default-value" ]
}

@test "config: config_load reads key-value pairs" {
    cat > "$TEST_TEMP_DIR/config" <<'EOF'
# comment line
TEST_KEY=from-file
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config.bash && config_load $TEST_TEMP_DIR/config && config_get TEST_KEY"
    [ "$status" -eq 0 ]
    [ "$output" = "from-file" ]
}

@test "config: config_require fails when missing" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config.bash && config_require NOT_SET"
    [ "$status" -ne 0 ]
    [[ "$output" =~ Required\ configuration ]]
}

@test "config: validate helpers enforce patterns" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config.bash && config_set URL https://example.com && config_validate_pattern URL '^https://[^ ]+$'"
    [ "$status" -eq 0 ]

    run bash -c "source $PROJECT_ROOT/tools/lib/config.bash && config_set URL ftp://example.com && config_validate_pattern URL '^https://[^ ]+$'"
    [ "$status" -ne 0 ]
}

@test "config: integer validation rejects non-positive" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config.bash && config_set COUNT 5 && config_validate_integer COUNT"
    [ "$status" -eq 0 ]

    run bash -c "source $PROJECT_ROOT/tools/lib/config.bash && config_set COUNT -1 && config_validate_integer COUNT"
    [ "$status" -ne 0 ]
}

@test "config: enum validation enforces allowed values" {
    run bash -c "source $PROJECT_ROOT/tools/lib/config.bash && config_set COLOR blue && config_validate_enum COLOR red blue green"
    [ "$status" -eq 0 ]

    run bash -c "source $PROJECT_ROOT/tools/lib/config.bash && config_set COLOR yellow && config_validate_enum COLOR red blue green"
    [ "$status" -ne 0 ]
}

@test "config: config_init_defaults sets DEVENV_ROOT" {
    expected_root=$(cd "$PROJECT_ROOT" && pwd)
    run bash -c "unset DEVENV_ROOT; source $PROJECT_ROOT/tools/lib/config.bash && config_init_defaults && config_get DEVENV_ROOT"
    [ "$status" -eq 0 ]
    [ "$output" = "$expected_root" ]
}
