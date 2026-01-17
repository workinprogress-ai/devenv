#!/usr/bin/env bats

# Test suite for validation.bash library
# Tests input validation and format checking

load ../test_helper

@test "source validation.bash library" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    [ -n "$_VALIDATION_LOADED" ]
}

@test "validation: source is idempotent" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    [ -n "$_VALIDATION_LOADED" ]
}

# ============================================================================
# String validation tests
# ============================================================================

@test "validate_not_empty with non-empty string" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_not_empty "hello"
}

@test "validate_not_empty with empty string" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_not_empty ""
}

@test "validate_not_empty with context message" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    output=$(validate_not_empty "" "username" 2>&1 || true)
    [[ "$output" =~ "username" ]]
}

@test "validate_string_length with valid length" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_string_length "hello" 1 10
}

@test "validate_string_length below minimum" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_string_length "hi" 3 10
}

@test "validate_string_length above maximum" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_string_length "hello world" 1 5
}

@test "validate_string_length without maximum" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_string_length "hello world" 1
}

@test "validate_alphanumeric with valid string" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_alphanumeric "abc123"
}

@test "validate_alphanumeric with hyphen" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_alphanumeric "abc-123"
}

@test "validate_alphanumeric with space" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_alphanumeric "abc 123"
}

@test "validate_slug with valid slug" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_slug "my-repo_name"
}

@test "validate_slug with space" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_slug "my repo name"
}

@test "validate_slug with special chars" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_slug "my@repo#name"
}

# ============================================================================
# Email validation tests
# ============================================================================

@test "validate_email with valid email" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_email "user@example.com"
}

@test "validate_email with subdomain" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_email "user@mail.example.com"
}

@test "validate_email without domain" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_email "userexample.com"
}

@test "validate_email without local part" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_email "@example.com"
}

@test "validate_email empty string" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_email ""
}

# ============================================================================
# URL validation tests
# ============================================================================

@test "validate_url with https" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_url "https://example.com"
}

@test "validate_url with http" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_url "http://example.com/path"
}

@test "validate_url without protocol" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_url "example.com"
}

@test "validate_url with ftp" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_url "ftp://example.com"
}

@test "validate_url empty string" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_url ""
}

# ============================================================================
# Integer validation tests
# ============================================================================

@test "validate_integer with valid positive integer" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_integer "42"
}

@test "validate_integer with zero" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_integer "0"
}

@test "validate_integer with negative" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_integer "-42"
}

@test "validate_integer with non-numeric" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_integer "abc"
}

@test "validate_integer with minimum" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_integer "50" 50
}

@test "validate_integer below minimum" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_integer "49" 50
}

@test "validate_integer with maximum" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_integer "100" 1 100
}

@test "validate_integer above maximum" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_integer "101" 1 100
}

@test "validate_positive_integer with valid" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_positive_integer "42"
}

@test "validate_positive_integer with zero" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_positive_integer "0"
}

@test "validate_positive_integer with negative" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_positive_integer "-1"
}

# ============================================================================
# File and directory validation tests
# ============================================================================

@test "validate_file_exists with existing file" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_file_exists "$DEVENV_ROOT/tools/lib/validation.bash"
}

@test "validate_file_exists with non-existing file" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_file_exists "/nonexistent/file.txt"
}

@test "validate_directory_exists with existing directory" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_directory_exists "$DEVENV_ROOT/tools/lib"
}

@test "validate_directory_exists with non-existing directory" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_directory_exists "/nonexistent/directory"
}

@test "validate_directory_readable with readable directory" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_directory_readable "$DEVENV_ROOT/tools/lib"
}

@test "validate_directory_writable with writable directory" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_directory_writable "/tmp"
}

# ============================================================================
# Choice validation tests
# ============================================================================

@test "validate_choice with valid choice" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_choice "create" "create" "update" "delete"
}

@test "validate_choice with invalid choice" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_choice "invalid" "create" "update" "delete"
}

@test "validate_choice with empty value" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_choice "" "create" "update" "delete"
}

@test "validate_choice case-sensitive" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_choice "Create" "create" "update" "delete"
}

# ============================================================================
# Git validation tests
# ============================================================================

@test "validate_branch_name with valid name" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_branch_name "main"
}

@test "validate_branch_name with feature branch" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_branch_name "feature/new-feature"
}

@test "validate_branch_name with slash suffix" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_branch_name "feature/"
}

@test "validate_branch_name with space" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_branch_name "feature branch"
}

@test "validate_commit_hash with valid short hash" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_commit_hash "abc1234"
}

@test "validate_commit_hash with valid long hash" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_commit_hash "abc1234567890abcdef1234567890abcdef123456"
}

@test "validate_commit_hash with uppercase" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_commit_hash "ABC1234"
}

@test "validate_commit_hash with too short" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_commit_hash "abc123"
}

# ============================================================================
# Version validation tests
# ============================================================================

@test "validate_semver with basic version" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_semver "1.2.3"
}

@test "validate_semver with prerelease" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_semver "1.2.3-rc1"
}

@test "validate_semver with build metadata" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_semver "1.2.3+build.123"
}

@test "validate_semver with prerelease and build" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_semver "1.2.3-beta.1+build.456"
}

@test "validate_semver with invalid format" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_semver "1.2"
}

@test "validate_semver with v prefix" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_semver "v1.2.3"
}

# ============================================================================
# Combined validators
# ============================================================================

@test "validate_required with all non-empty" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_required "a" "b" "c"
}

@test "validate_required with one empty" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_required "a" "" "c"
}

@test "validate_required with no arguments" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_required
}

# ============================================================================
# TitleCase identifier validation tests
# ============================================================================

@test "validate_identifier_titlecase with valid TitleCase" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_identifier_titlecase "MyIdentifier"
}

@test "validate_identifier_titlecase with single uppercase letter" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_identifier_titlecase "A"
}

@test "validate_identifier_titlecase with mixed case numbers" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_identifier_titlecase "MyService123"
}

@test "validate_identifier_titlecase with all uppercase" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_identifier_titlecase "CONSTANT"
}

@test "validate_identifier_titlecase with empty string" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_identifier_titlecase ""
}

@test "validate_identifier_titlecase with lowercase start" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_identifier_titlecase "myIdentifier"
}

@test "validate_identifier_titlecase with space" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_identifier_titlecase "My Identifier"
}

@test "validate_identifier_titlecase with hyphen" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_identifier_titlecase "My-Identifier"
}

@test "validate_identifier_titlecase with underscore" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_identifier_titlecase "My_Identifier"
}

@test "validate_identifier_titlecase with dot" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_identifier_titlecase "My.Identifier"
}

@test "validate_identifier_titlecase with special characters" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_identifier_titlecase "My@Identifier"
}

@test "validate_identifier_titlecase with context message" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    output=$(validate_identifier_titlecase "invalid" "CustomContext" 2>&1 || true)
    [[ "$output" =~ "CustomContext" ]]
}

@test "validate_identifier_titlecase with default context" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    output=$(validate_identifier_titlecase "" 2>&1 || true)
    [[ "$output" =~ "identifier" ]]
}

@test "validate_identifier_titlecase with numeric start" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    ! validate_identifier_titlecase "1MyIdentifier"
}

# ============================================================================
# Integration tests
# ============================================================================

@test "all validation functions are exported" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    
    declare -F validate_not_empty > /dev/null
    declare -F validate_integer > /dev/null
    declare -F validate_email > /dev/null
    declare -F validate_url > /dev/null
    declare -F validate_semver > /dev/null
}

@test "validation library loads without error-handling library" {
    local temp_root=$(mktemp -d)
    mkdir -p "$temp_root/tools/lib"
    cp "$DEVENV_ROOT/tools/lib/validation.bash" "$temp_root/tools/lib/"
    
    source "$temp_root/tools/lib/validation.bash" 2>/dev/null || true
    rm -rf "$temp_root"
}

# ============================================================================
# Edge cases
# ============================================================================

@test "validate_string_length with exact minimum" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_string_length "a" 1 5
}

@test "validate_string_length with exact maximum" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_string_length "hello" 1 5
}

@test "validate_email with numeric local part" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_email "123@example.com"
}

@test "validate_slug with numbers" {
    source "$DEVENV_ROOT/tools/lib/validation.bash"
    validate_slug "repo-123_test"
}
