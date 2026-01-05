#!/usr/bin/env bats
# Tests for issue-helper.bash library
# Tests dynamic issue type management from config

bats_require_minimum_version 1.5.0

setup() {
    # Handle both test locations (tests/ and tests/lib/ or tests/scripts/ or tests/devenv/)
    if [[ "$BATS_TEST_DIRNAME" =~ /tests/(lib|scripts|devenv)$ ]]; then
        export PROJECT_ROOT="${BATS_TEST_DIRNAME}/../../.."
    else
        export PROJECT_ROOT="${BATS_TEST_DIRNAME}/../.."
    fi
    export DEVENV_ROOT="$PROJECT_ROOT"
    export TEST_TEMP_DIR="$(mktemp -d)"
    export TEST_CONFIG_FILE="$TEST_TEMP_DIR/test.config"
}

teardown() {
    if [ -d "$TEST_TEMP_DIR" ]; then
        rm -rf "$TEST_TEMP_DIR"
    fi
}

# Helper to create a test config file
create_test_config() {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
status_workflow=TBD,Ready,In Progress,Done
issue_types=story,bug,enhancement,documentation
EOF
}

@test "issue-helper: library can be sourced" {
    run bash -c "source $PROJECT_ROOT/tools/lib/issue-helper.bash && echo loaded"
    [ "$status" -eq 0 ]
    [[ "$output" =~ loaded ]]
}

@test "issue-helper: load_issue_types_from_config fails with missing config file" {
    run bash -c "source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config /nonexistent/config 2>&1"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "not found" ]]
}

@test "issue-helper: load_issue_types_from_config fails when config_init not available" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE 2>&1"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "config_init" ]]
}

@test "issue-helper: load_issue_types_from_config succeeds when both libraries sourced" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE && echo success"
    [ "$status" -eq 0 ]
    [[ "$output" =~ success ]]
}

@test "issue-helper: load_issue_types_from_config populates ISSUE_TYPES array" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE && echo \${#ISSUE_TYPES[@]}"
    [ "$status" -eq 0 ]
    [ "$output" = "4" ]
}

@test "issue-helper: ISSUE_TYPES array contains all configured types" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE && printf '%s\\n' \"\${ISSUE_TYPES[@]}\""
    [ "$status" -eq 0 ]
    [[ "$output" =~ story ]]
    [[ "$output" =~ bug ]]
    [[ "$output" =~ enhancement ]]
    [[ "$output" =~ documentation ]]
}

@test "issue-helper: load_issue_types_from_config fails when issue_types missing from config" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
status_workflow=TBD,Done
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE 2>&1"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "issue_types" ]]
}

@test "issue-helper: build_type_menu generates numbered menu" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE && build_type_menu"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "1) Story" ]]
    [[ "$output" =~ "2) Bug" ]]
    [[ "$output" =~ "3) Enhancement" ]]
    [[ "$output" =~ "4) Documentation" ]]
}

@test "issue-helper: build_type_menu capitalizes issue types" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
issue_types=story,bug
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE && build_type_menu | head -1"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Story" ]]
}

@test "issue-helper: get_type_label_from_choice returns correct label" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE && get_type_label_from_choice 1"
    [ "$status" -eq 0 ]
    [ "$output" = "type:story" ]
}

@test "issue-helper: get_type_label_from_choice works for all types" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE && get_type_label_from_choice 2"
    [ "$status" -eq 0 ]
    [ "$output" = "type:bug" ]
}

@test "issue-helper: get_type_label_from_choice fails for invalid choice" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE && get_type_label_from_choice 99"
    [ "$status" -ne 0 ]
}

@test "issue-helper: get_type_label_from_choice fails for zero choice" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE && get_type_label_from_choice 0"
    [ "$status" -ne 0 ]
}

@test "issue-helper: get_all_type_labels returns all labels" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE && get_all_type_labels"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "type:story" ]]
    [[ "$output" =~ "type:bug" ]]
    [[ "$output" =~ "type:enhancement" ]]
    [[ "$output" =~ "type:documentation" ]]
}

@test "issue-helper: get_all_type_labels output is space-separated" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
issue_types=story,bug
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE && get_all_type_labels | tr ' ' '\\n'"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "type:story" ]]
    [[ "$output" =~ "type:bug" ]]
}

@test "issue-helper: handles hyphenated issue types" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
issue_types=story,bug,feature-request,documentation
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE && echo \${#ISSUE_TYPES[@]}"
    [ "$status" -eq 0 ]
    [ "$output" = "4" ]
}

@test "issue-helper: handles single issue type in config" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
issue_types=bug
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-helper.bash && load_issue_types_from_config $TEST_CONFIG_FILE && get_type_label_from_choice 1"
    [ "$status" -eq 0 ]
    [ "$output" = "type:bug" ]
}
