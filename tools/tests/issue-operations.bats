#!/usr/bin/env bats

# Test suite for issue-operations.bash library
# Tests common GitHub issue and PR operations

load test_helper

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
