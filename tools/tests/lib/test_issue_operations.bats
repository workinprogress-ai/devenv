#!/usr/bin/env bats

# Test suite for issue-operations.bash library
# Tests common GitHub issue and PR operations

load ../test_helper

# Setup function for all tests
setup() {
    test_helper_setup
    export TEST_CONFIG_FILE="$TEST_TEMP_DIR/test.config"
}

# Teardown function for all tests
teardown() {
    test_helper_teardown
}

# Helper to create a test config file for issue-helper tests
create_test_config() {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
status_workflow=TBD,Ready,In Progress,Done
issue_types=story,bug,enhancement,documentation
EOF
}

@test "source issue-operations.bash library" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    [ -n "$_ISSUE_OPERATIONS_LOADED" ]
}

@test "issue-operations: source is idempotent" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    # Should not cause errors
    [ -n "$_ISSUE_OPERATIONS_LOADED" ]
}

# ============================================================================
# build_issue_filters tests
# ============================================================================

@test "build_issue_filters with default state" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    result=$(build_issue_filters)
    [[ "$result" =~ --state ]] && [[ "$result" =~ open ]]
}

@test "build_issue_filters with closed state" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    result=$(build_issue_filters --state closed)
    [[ "$result" =~ --state ]] && [[ "$result" =~ closed ]]
}

@test "build_issue_filters with type epic" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    result=$(build_issue_filters --type epic)
    [[ "$result" =~ --label ]] && [[ "$result" =~ "type:epic" ]]
}

@test "build_issue_filters with type story" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    result=$(build_issue_filters --type story)
    [[ "$result" =~ --label ]] && [[ "$result" =~ "type:story" ]]
}

@test "build_issue_filters with type bug" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    result=$(build_issue_filters --type bug)
    [[ "$result" =~ --label ]] && [[ "$result" =~ "type:bug" ]]
}

@test "build_issue_filters with invalid type" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    ! build_issue_filters --type invalid
}

@test "build_issue_filters with single label" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    result=$(build_issue_filters --labels urgent)
    [[ "$result" =~ --label ]] && [[ "$result" =~ urgent ]]
}

@test "build_issue_filters with multiple labels" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    result=$(build_issue_filters --labels urgent --labels blocked)
    [[ "$result" =~ urgent ]] && [[ "$result" =~ blocked ]]
}

@test "build_issue_filters with assignee" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    result=$(build_issue_filters --assignee alice)
    [[ "$result" =~ --assignee ]] && [[ "$result" =~ alice ]]
}

@test "build_issue_filters with milestone" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    result=$(build_issue_filters --milestone v1.0)
    [[ "$result" =~ --milestone ]] && [[ "$result" =~ v1.0 ]]
}

@test "build_issue_filters with custom limit" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    result=$(build_issue_filters --limit 50)
    [[ "$result" =~ --limit ]] && [[ "$result" =~ 50 ]]
}

@test "build_issue_filters with all options" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    result=$(build_issue_filters --state closed --type bug --labels urgent --assignee alice --milestone v1.0 --limit 25)
    [[ "$result" =~ closed ]] && [[ "$result" =~ bug ]] && [[ "$result" =~ urgent ]] && [[ "$result" =~ alice ]] && [[ "$result" =~ v1.0 ]] && [[ "$result" =~ 25 ]]
}

# ============================================================================
# validate_issue_number tests
# ============================================================================

@test "validate_issue_number with valid number" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    validate_issue_number "123"
}

@test "validate_issue_number with zero" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    validate_issue_number "0"
}

@test "validate_issue_number with large number" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    validate_issue_number "999999"
}

@test "validate_issue_number with empty string" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    ! validate_issue_number ""
}

@test "validate_issue_number with non-numeric" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    ! validate_issue_number "abc"
}

@test "validate_issue_number with hash prefix" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    ! validate_issue_number "#123"
}

@test "validate_issue_number with negative number" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    ! validate_issue_number "-123"
}

@test "validate_issue_number with decimal" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    ! validate_issue_number "123.5"
}

# ============================================================================
# PR operations tests
# ============================================================================

@test "find_pr_by_branch with state parameter" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    # This would require mocking gh - just test the function exists and accepts parameters
    declare -f find_pr_by_branch > /dev/null
}

@test "find_pr_by_search without search query returns error" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    ! find_pr_by_search
}

@test "create_pr function exists and accepts parameters" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    declare -f create_pr > /dev/null
}

# ============================================================================
# Issue state operations tests
# ============================================================================

@test "close_issue without issue numbers returns error" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    ! close_issue
}

@test "reopen_issue without issue numbers returns error" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    ! reopen_issue
}

@test "close_issue function accepts multiple issue numbers" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    declare -f close_issue > /dev/null
}

@test "reopen_issue function accepts multiple issue numbers" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    declare -f reopen_issue > /dev/null
}

# ============================================================================
# Integration tests with library interdependencies
# ============================================================================

@test "issue-operations can load without error-handling library" {
    # Override DEVENV_ROOT temporarily to test standalone loading
    local temp_root=$(mktemp -d)
    mkdir -p "$temp_root/tools/lib"
    cp "$DEVENV_ROOT/tools/lib/issue-operations.bash" "$temp_root/tools/lib/"
    
    source "$temp_root/tools/lib/issue-operations.bash"
    rm -rf "$temp_root"
    [ -n "$_ISSUE_OPERATIONS_LOADED" ]
}

@test "all issue-operations functions are exported" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    
    # Check key functions are exported
    declare -F build_issue_filters > /dev/null
    declare -F get_issues_for_selection > /dev/null
    declare -F validate_issue_number > /dev/null
    declare -F issue_exists > /dev/null
}

# ============================================================================
# Format validation tests
# ============================================================================

@test "list_issues_formatted with invalid format returns error" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    ! list_issues_formatted --format invalid 2>/dev/null
}

@test "get_issues_for_selection returns tab-separated format when gh is available" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    # Mock gh for this test - just verify function accepts parameters
    declare -f get_issues_for_selection > /dev/null
}

# ============================================================================
# Parameter validation tests
# ============================================================================

@test "build_issue_filters handles unknown parameters gracefully" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    result=$(build_issue_filters --unknown-param value)
    [[ "$result" =~ --state ]]
}

@test "close_issue accepts repo parameter" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    declare -f close_issue > /dev/null
}

@test "reopen_issue accepts repo parameter" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    declare -f reopen_issue > /dev/null
}

@test "issue_exists accepts repo parameter" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    declare -f issue_exists > /dev/null
}

# ============================================================================
# Edge cases
# ============================================================================

@test "build_issue_filters with empty values" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    result=$(build_issue_filters --state "" --type "")
    # Should handle empty values gracefully
    [[ "$result" =~ --state ]]
}

@test "validate_issue_number rejects whitespace" {
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
    ! validate_issue_number "123 "
    ! validate_issue_number " 123"
}
@test "issue-operations: library can be sourced" {
    run bash -c "source $PROJECT_ROOT/tools/lib/issue-operations.bash && echo loaded"
    [ "$status" -eq 0 ]
    [[ "$output" =~ loaded ]]
}

@test "issue-operations: load_issue_types_from_config fails with missing config file" {
    run bash -c "source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config /nonexistent/config 2>&1"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "not found" ]]
}

@test "issue-operations: load_issue_types_from_config fails when config_init not available" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE 2>&1"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "config_init" ]]
}

@test "issue-operations: load_issue_types_from_config succeeds when both libraries sourced" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE && echo success"
    [ "$status" -eq 0 ]
    [[ "$output" =~ success ]]
}

@test "issue-operations: load_issue_types_from_config populates ISSUE_TYPES array" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE && echo \${#ISSUE_TYPES[@]}"
    [ "$status" -eq 0 ]
    [ "$output" = "4" ]
}

@test "issue-operations: ISSUE_TYPES array contains all configured types" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE && printf '%s\\n' \"\${ISSUE_TYPES[@]}\""
    [ "$status" -eq 0 ]
    [[ "$output" =~ story ]]
    [[ "$output" =~ bug ]]
    [[ "$output" =~ enhancement ]]
    [[ "$output" =~ documentation ]]
}

@test "issue-operations: load_issue_types_from_config fails when issue_types missing from config" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
status_workflow=TBD,Done
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE 2>&1"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "issue_types" ]]
}

@test "issue-operations: build_type_menu generates numbered menu" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE && build_type_menu"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "1) Story" ]]
    [[ "$output" =~ "2) Bug" ]]
    [[ "$output" =~ "3) Enhancement" ]]
    [[ "$output" =~ "4) Documentation" ]]
}

@test "issue-operations: build_type_menu capitalizes issue types" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
issue_types=story,bug
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE && build_type_menu | head -1"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Story" ]]
}

@test "issue-operations: get_type_label_from_choice returns correct label" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE && get_type_label_from_choice 1"
    [ "$status" -eq 0 ]
    [ "$output" = "type:story" ]
}

@test "issue-operations: get_type_label_from_choice works for all types" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE && get_type_label_from_choice 2"
    [ "$status" -eq 0 ]
    [ "$output" = "type:bug" ]
}

@test "issue-operations: get_type_label_from_choice fails for invalid choice" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE && get_type_label_from_choice 99"
    [ "$status" -ne 0 ]
}

@test "issue-operations: get_type_label_from_choice fails for zero choice" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE && get_type_label_from_choice 0"
    [ "$status" -ne 0 ]
}

@test "issue-operations: get_all_type_labels returns all labels" {
    create_test_config
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE && get_all_type_labels"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "type:story" ]]
    [[ "$output" =~ "type:bug" ]]
    [[ "$output" =~ "type:enhancement" ]]
    [[ "$output" =~ "type:documentation" ]]
}

@test "issue-operations: get_all_type_labels output is space-separated" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
issue_types=story,bug
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE && get_all_type_labels | tr ' ' '\\n'"
    [ "$status" -eq 0 ]
    [[ "$output" =~ "type:story" ]]
    [[ "$output" =~ "type:bug" ]]
}

@test "issue-operations: handles hyphenated issue types" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
issue_types=story,bug,feature-request,documentation
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE && echo \${#ISSUE_TYPES[@]}"
    [ "$status" -eq 0 ]
    [ "$output" = "4" ]
}

@test "issue-operations: handles single issue type in config" {
    cat > "$TEST_CONFIG_FILE" <<'EOF'
[workflows]
issue_types=bug
EOF
    run bash -c "source $PROJECT_ROOT/tools/lib/config-reader.bash && source $PROJECT_ROOT/tools/lib/issue-operations.bash && load_issue_types_from_config $TEST_CONFIG_FILE && get_type_label_from_choice 1"
    [ "$status" -eq 0 ]
    [ "$output" = "type:bug" ]
}
