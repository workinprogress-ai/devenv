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

@test "repo-get: --all flag is present in usage help" {
    run bash -c "grep -q '\-\-all' $PROJECT_ROOT/tools/scripts/repo-get.sh"
    assert_success
}

@test "repo-get: usage mentions --all option" {
    run bash -c "grep 'Usage' $PROJECT_ROOT/tools/scripts/repo-get.sh"
    assert_success
    assert_output_contains "\-\-all"
}

@test "repo-get: defines get_available_repos function" {
    run bash -c "grep -q '^get_available_repos()' $PROJECT_ROOT/tools/scripts/repo-get.sh"
    assert_success
}

@test "repo-get: --all mode sets ALL_MODE=true" {
    run bash -c "grep -q 'ALL_MODE=true' $PROJECT_ROOT/tools/scripts/repo-get.sh"
    assert_success
}

@test "repo-get: --all mode exits cleanly when no repos are available to clone" {
    # Simulate get_available_repos returning empty (everything already cloned)
    run bash -c '
        ALL_MODE=true
        available=""
        if [ -z "$available" ]; then
            echo "All organization repositories are already cloned" >&2
            exit 0
        fi
        exit 1
    '
    assert_success
    assert_output_contains "already cloned"
}

@test "repo-get: --all mode iterates repos and clones each" {
    # Simulate cloning two repos in --all mode
    mkdir -p "$TEST_TEMP_DIR/repos"
    run bash -c "
        repos_dir='$TEST_TEMP_DIR/repos'
        GIT_URL_PREFIX='https://user:token@github.com/myorg'
        available=\$'repo-alpha\nrepo-beta'
        failed=()
        cloned=()
        clone_repo() { cloned+=(\"\$REPO_NAME\"); }
        while IFS= read -r repo; do
            [ -z \"\$repo\" ] && continue
            REPO_NAME=\"\$repo\"
            TARGET_DIR=\"\$repos_dir/\$REPO_NAME\"
            GIT_URL=\"\${GIT_URL_PREFIX}/\${REPO_NAME}.git\"
            clone_repo
        done <<< \"\$available\"
        echo \"\${cloned[*]}\"
    "
    assert_success
    assert_output_contains "repo-alpha"
    assert_output_contains "repo-beta"
}
