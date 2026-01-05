#!/usr/bin/env bats
# Tests for repo-operations.bash library
# Tests for repository discovery, listing, and filtering operations

load test_helper

setup() {
    test_helper_setup
    export TEST_REPOS_DIR="$TEST_TEMP_DIR/repos"
    mkdir -p "$TEST_REPOS_DIR"
}

teardown() {
    rm -rf "$TEST_TEMP_DIR"
}

# ============================================================================
# Library Loading Tests
# ============================================================================

@test "repo-operations: library can be sourced" {
    run bash -c "source '$PROJECT_ROOT/tools/lib/repo-operations.bash' && echo 'loaded'"
    [ "$status" -eq 0 ]
    [[ "$output" == *"loaded"* ]]
}

@test "repo-operations: prevents multiple sourcing" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        _REPO_OPERATIONS_LOADED=1
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        echo 'success'
    "
    [ "$status" -eq 0 ]
}

@test "repo-operations: has valid bash syntax" {
    run bash -n "$PROJECT_ROOT/tools/lib/repo-operations.bash"
    [ "$status" -eq 0 ]
}

# ============================================================================
# list_local_repositories Tests
# ============================================================================

@test "repo-operations: list_local_repositories requires base directory" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        list_local_repositories 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"Base directory is required"* ]]
}

@test "repo-operations: list_local_repositories returns empty for nonexistent directory" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        list_local_repositories '/nonexistent/path' 2>&1
    "
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "repo-operations: list_local_repositories discovers local repos" {
    mkdir -p "$TEST_REPOS_DIR/repo1" "$TEST_REPOS_DIR/repo2" "$TEST_REPOS_DIR/repo3"
    
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        list_local_repositories '$TEST_REPOS_DIR' | sort
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo1"* ]]
    [[ "$output" == *"repo2"* ]]
    [[ "$output" == *"repo3"* ]]
}

@test "repo-operations: list_local_repositories ignores nested directories" {
    mkdir -p "$TEST_REPOS_DIR/repo1/nested" "$TEST_REPOS_DIR/repo2"
    
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        list_local_repositories '$TEST_REPOS_DIR' | wc -l
    "
    [ "$status" -eq 0 ]
    [ "$output" -eq 2 ]
}

# ============================================================================
# filter_available_repositories Tests
# ============================================================================

@test "repo-operations: filter_available_repositories requires org repos" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        filter_available_repositories '' 'repo1' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"Organization repositories list is required"* ]]
}

@test "repo-operations: filter_available_repositories returns all when no local repos" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        org_repos='repo1
repo2
repo3'
        filter_available_repositories \"\$org_repos\" ''
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo1"* ]]
    [[ "$output" == *"repo2"* ]]
    [[ "$output" == *"repo3"* ]]
}

@test "repo-operations: filter_available_repositories excludes local repos" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        org_repos='repo1
repo2
repo3'
        local_repos='repo2'
        filter_available_repositories \"\$org_repos\" \"\$local_repos\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo1"* ]]
    [[ "$output" != *"repo2"* ]]
    [[ "$output" == *"repo3"* ]]
}

@test "repo-operations: filter_available_repositories handles multiple exclusions" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        org_repos='repo1
repo2
repo3
repo4'
        local_repos='repo1
repo3'
        filter_available_repositories \"\$org_repos\" \"\$local_repos\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" != *"repo1"* ]]
    [[ "$output" == *"repo2"* ]]
    [[ "$output" != *"repo3"* ]]
    [[ "$output" == *"repo4"* ]]
}

# ============================================================================
# validate_repository_name Tests
# ============================================================================

@test "repo-operations: validate_repository_name requires name" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        validate_repository_name '' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"Repository name is required"* ]]
}

@test "repo-operations: validate_repository_name accepts valid names" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        validate_repository_name 'my-repo' && echo 'valid1' &&
        validate_repository_name 'my.repo' && echo 'valid2' &&
        validate_repository_name 'repo123' && echo 'valid3' &&
        echo 'all_valid'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"all_valid"* ]]
}

@test "repo-operations: validate_repository_name rejects reserved names" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        validate_repository_name 'repos' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"reserved"* ]]
}

@test "repo-operations: validate_repository_name rejects dot names" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        validate_repository_name '.' 2>&1
    "
    [ "$status" -eq 1 ]
}

@test "repo-operations: validate_repository_name rejects names starting with hyphen" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        validate_repository_name '-repo' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"Invalid repository name format"* ]]
}

@test "repo-operations: validate_repository_name rejects invalid characters" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        validate_repository_name 'repo@name' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"Invalid repository name format"* ]]
}

# ============================================================================
# repository_exists_locally Tests
# ============================================================================

@test "repo-operations: repository_exists_locally requires both arguments" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        repository_exists_locally 'repo' '' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"required"* ]]
}

@test "repo-operations: repository_exists_locally returns true for existing repo" {
    mkdir -p "$TEST_REPOS_DIR/test-repo"
    
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        repository_exists_locally 'test-repo' '$TEST_REPOS_DIR'
    "
    [ "$status" -eq 0 ]
}

@test "repo-operations: repository_exists_locally returns false for missing repo" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        repository_exists_locally 'missing-repo' '$TEST_REPOS_DIR'
    "
    [ "$status" -eq 1 ]
}

# ============================================================================
# find_repository_by_name Tests
# ============================================================================

@test "repo-operations: find_repository_by_name requires repo name" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        find_repository_by_name '' '$TEST_REPOS_DIR' 2>&1
    "
    [ "$status" -eq 1 ]
}

@test "repo-operations: find_repository_by_name finds exact match" {
    mkdir -p "$TEST_REPOS_DIR/exact-name"
    
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        find_repository_by_name 'exact-name' '$TEST_REPOS_DIR'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"exact-name"* ]]
}

@test "repo-operations: find_repository_by_name returns not found for missing repo" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        find_repository_by_name 'missing' '$TEST_REPOS_DIR'
    "
    [ "$status" -eq 1 ]
}

# ============================================================================
# get_current_repository_name Tests
# ============================================================================

@test "repo-operations: get_current_repository_name returns repo name from git context" {
    run bash -c "
        cd '$PROJECT_ROOT'
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        get_current_repository_name
    "
    [ "$status" -eq 0 ]
    [[ "$output" == "devenv" ]]
}

# ============================================================================
# is_devenv_repository Tests
# ============================================================================

@test "repo-operations: is_devenv_repository returns true in devenv" {
    run bash -c "
        cd '$PROJECT_ROOT'
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        is_devenv_repository
    "
    [ "$status" -eq 0 ]
}

# ============================================================================
# get_or_create_repos_directory Tests
# ============================================================================

@test "repo-operations: get_or_create_repos_directory uses DEVENV_ROOT" {
    run bash -c "
        export DEVENV_ROOT='$TEST_TEMP_DIR'
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        result=\$(get_or_create_repos_directory)
        [ -d \"\$result\" ] && echo \"success\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"success"* ]]
}

@test "repo-operations: get_or_create_repos_directory creates directory if missing" {
    run bash -c "
        export DEVENV_ROOT='$TEST_TEMP_DIR/new_location'
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        result=\$(get_or_create_repos_directory)
        [ -d \"\$result\" ] && echo \"directory_created\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"directory_created"* ]]
    [ -d "$TEST_TEMP_DIR/new_location/repos" ]
}

@test "repo-operations: get_or_create_repos_directory returns path" {
    run bash -c "
        export DEVENV_ROOT='$TEST_TEMP_DIR'
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        get_or_create_repos_directory
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"repos"* ]]
}
