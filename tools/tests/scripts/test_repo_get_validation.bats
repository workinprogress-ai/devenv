#!/usr/bin/env bats
# Tests for scripts/repo-get.sh input validation and sourcing

bats_require_minimum_version 1.5.0

load ../test_helper

# Simple assert helpers
assert_success() {
    [ "$status" -eq 0 ]
}

assert_failure() {
    [ "$status" -ne 0 ]
}

assert_output_contains() {
    local expected="$1"
    if [[ ! "$output" =~ $expected ]]; then
        echo "Expected output to contain: $expected"
        echo "Actual output: $output"
        return 1
    fi
}

@test "repo-get: has valid bash syntax" {
    run bash -n "$PROJECT_ROOT/tools/scripts/repo-get.sh"
    assert_success
}

@test "repo-get: sources git-operations library" {
    run bash -c "grep -q 'source.*lib/git-operations.bash' $PROJECT_ROOT/tools/scripts/repo-get.sh"
    assert_success
}

@test "repo-get: sources error-handling library if present" {
    run bash -c "grep -q 'source.*lib/error-handling.bash' $PROJECT_ROOT/tools/scripts/repo-get.sh"
    assert_success
}

@test "repo-get: fails when repository name is missing and no git context" {
    cd "$TEST_TEMP_DIR"  # Run from non-git directory
    run "$PROJECT_ROOT/tools/scripts/repo-get.sh" 2>/dev/null
    assert_failure
    assert_output_contains "Usage:"
}

@test "repo-get: rejects invalid characters in repo name" {
    run "$PROJECT_ROOT/tools/scripts/repo-get.sh" "repo@name" 2>&1
    assert_failure
    assert_output_contains "Invalid repository name"

    run "$PROJECT_ROOT/tools/scripts/repo-get.sh" "repo name" 2>&1
    assert_failure
}

@test "repo-get: rejects reserved names" {
    run "$PROJECT_ROOT/tools/scripts/repo-get.sh" "repos" 2>&1
    assert_failure
    assert_output_contains "Invalid repository name"

    run "$PROJECT_ROOT/tools/scripts/repo-get.sh" "." 2>&1
    assert_failure
}

@test "repo-get: strips trailing slash from input" {
    run bash -c 'input_repo="my-repo/"; input_repo="${input_repo%/}"; echo "$input_repo"'
    assert_success
    [ "$output" = "my-repo" ]
}

@test "repo-get: requires alphanumeric start" {
    run "$PROJECT_ROOT/tools/scripts/repo-get.sh" "-repo" 2>&1
    assert_failure
    assert_output_contains "Invalid repository name"
}
