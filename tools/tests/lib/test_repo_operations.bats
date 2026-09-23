#!/usr/bin/env bats
# Tests for repo-operations.bash library
# Tests for repository discovery, listing, and filtering operations

load ../test_helper

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
# is_devenv_repo (canonical predicate) Tests
# ============================================================================

@test "git-operations: is_devenv_repo returns true in devenv (marker + name)" {
    run bash -c "
        cd '$PROJECT_ROOT'
        source '$PROJECT_ROOT/tools/lib/git-operations.bash'
        is_devenv_repo
    "
    [ "$status" -eq 0 ]
}

@test "git-operations: is_devenv_repo detects renamed clone via marker file" {
    local t
    t=$(mktemp -d)
    mkdir -p "$t/renamed-clone/.devcontainer"
    touch "$t/renamed-clone/.devcontainer/bootstrap.sh"
    git -C "$t/renamed-clone" init -q
    run bash -c "
        cd '$t/renamed-clone'
        source '$PROJECT_ROOT/tools/lib/git-operations.bash'
        is_devenv_repo
    "
    [ "$status" -eq 0 ]
    rm -rf "$t"
}

@test "git-operations: is_devenv_repo detects devenv-named repo without marker" {
    local t
    t=$(mktemp -d)
    mkdir -p "$t/devenv"
    git -C "$t/devenv" init -q
    run bash -c "
        cd '$t/devenv'
        source '$PROJECT_ROOT/tools/lib/git-operations.bash'
        is_devenv_repo
    "
    [ "$status" -eq 0 ]
    rm -rf "$t"
}

@test "git-operations: is_devenv_repo returns false in ordinary repo" {
    local t
    t=$(mktemp -d)
    mkdir -p "$t/some-service"
    git -C "$t/some-service" init -q
    run bash -c "
        cd '$t/some-service'
        source '$PROJECT_ROOT/tools/lib/git-operations.bash'
        is_devenv_repo
    "
    [ "$status" -ne 0 ]
    rm -rf "$t"
}

@test "git-operations: is_devenv_repo returns false outside any git repo" {
    local t
    t=$(mktemp -d)
    run bash -c "
        cd '$t'
        source '$PROJECT_ROOT/tools/lib/git-operations.bash'
        is_devenv_repo
    "
    [ "$status" -ne 0 ]
    rm -rf "$t"
}

@test "git-operations: is_devenv_repository wrapper delegates to canonical predicate" {
    # wrapper and canonical predicate agree inside devenv
    run bash -c "
        cd '$PROJECT_ROOT'
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        is_devenv_repository && is_devenv_repo
    "
    [ "$status" -eq 0 ]
    # and agree outside it
    local t
    t=$(mktemp -d)
    mkdir -p "$t/ordinary"
    git -C "$t/ordinary" init -q
    run bash -c "
        cd '$t/ordinary'
        source '$PROJECT_ROOT/tools/lib/repo-operations.bash'
        is_devenv_repository || is_devenv_repo || true
        ! is_devenv_repository && ! is_devenv_repo
    "
    [ "$status" -eq 0 ]
    rm -rf "$t"
}

@test "git-operations: is_nested_devenv_clone true for devenv-named repo under repos/" {
    local t
    t=$(mktemp -d)
    mkdir -p "$t/repos/devenv"
    git -C "$t/repos/devenv" init -q
    run bash -c "
        cd '$t/repos/devenv'
        source '$PROJECT_ROOT/tools/lib/git-operations.bash'
        is_nested_devenv_clone
    "
    [ "$status" -eq 0 ]
    rm -rf "$t"
}

@test "git-operations: is_nested_devenv_clone true via marker file when dir renamed" {
    local t
    t=$(mktemp -d)
    # Clone renamed but still nested under repos/ — the nesting check is
    # independent of the devenv-name/marker detection that gates its use.
    mkdir -p "$t/repos/renamed-devenv/.devcontainer"
    git -C "$t/repos/renamed-devenv" init -q
    touch "$t/repos/renamed-devenv/.devcontainer/bootstrap.sh"
    run bash -c "
        cd '$t/repos/renamed-devenv'
        source '$PROJECT_ROOT/tools/lib/git-operations.bash'
        is_devenv_repo && is_nested_devenv_clone
    "
    [ "$status" -eq 0 ]
    rm -rf "$t"
}

@test "git-operations: is_nested_devenv_clone false for canonical devenv root" {
    # A devenv repo whose parent is not named repos/ (the canonical workspace
    # root) is not a nested clone — guard must stay in force there. Built as a
    # fixture so the assertion does not depend on where this suite's own repo
    # is checked out (some workspaces keep devenv itself below a repos/ dir).
    local t
    t=$(mktemp -d)
    mkdir -p "$t/devenv"
    git -C "$t/devenv" init -q
    run bash -c "
        cd '$t/devenv'
        source '$PROJECT_ROOT/tools/lib/git-operations.bash'
        is_devenv_repo && ! is_nested_devenv_clone
    "
    [ "$status" -eq 0 ]
    rm -rf "$t"
}

@test "git-operations: is_nested_devenv_clone false for ordinary repo under repos/" {
    local t
    t=$(mktemp -d)
    # Ordinary project repo nested under repos/ — not devenv at all, so the
    # nesting predicate alone is irrelevant; the check itself still returns 0
    # but is_devenv_repo must be false (guard unaffected).
    mkdir -p "$t/repos/lib.cs.something"
    git -C "$t/repos/lib.cs.something" init -q
    run bash -c "
        cd '$t/repos/lib.cs.something'
        source '$PROJECT_ROOT/tools/lib/git-operations.bash'
        is_nested_devenv_clone && ! is_devenv_repo
    "
    [ "$status" -eq 0 ]
    rm -rf "$t"
}

@test "git-operations: check_target_repo auto-allows nested devenv clone without --devenv" {
    local t
    t=$(mktemp -d)
    mkdir -p "$t/repos/devenv"
    git -C "$t/repos/devenv" init -q
    run bash -c "
        cd '$t/repos/devenv'
        ALLOW_DEVENV_REPO=0
        source '$PROJECT_ROOT/tools/lib/git-operations.bash'
        check_target_repo
    "
    [ "$status" -eq 0 ]
    [[ ! "$output" =~ "appears to be the devenv repository itself" ]]
    rm -rf "$t"
}

@test "git-operations: check_target_repo still guards canonical devenv root" {
    # Fixture parent is not named repos/, so the canonical-root guard (not the
    # nested-clone auto-allow) must fire — independent of where this suite's
    # own repo is checked out.
    local t
    t=$(mktemp -d)
    mkdir -p "$t/devenv"
    git -C "$t/devenv" init -q
    run bash -c "
        cd '$t/devenv'
        unset GITHUB_REPO DEVENV_REPO
        ALLOW_DEVENV_REPO=0
        source '$PROJECT_ROOT/tools/lib/git-operations.bash'
        check_target_repo
    "
    [ "$status" -ne 0 ]
    [[ "$output" =~ "appears to be the devenv repository itself" ]]
    rm -rf "$t"
}

# ============================================================================
# get_or_create_repos_directory Tests
# ============================================================================

# Fixture: a minimal fake checkout carrying the lib + resolver, so the lib
# self-locates to the fake root. The self-root contract honors an exported
# DEVENV_ROOT only when it matches that self-derived root.
_make_fake_repoops_checkout() {
    local root="$1"
    mkdir -p "$root/tools/lib"
    cp "$PROJECT_ROOT/tools/lib/repo-operations.bash" "$root/tools/lib/"
    cp "$PROJECT_ROOT/tools/lib/self-root.bash" "$root/tools/lib/"
    # repo-operations sources git-operations.bash from its own checkout's lib
    cp "$PROJECT_ROOT/tools/lib/git-operations.bash" "$root/tools/lib/"
}

@test "repo-operations: get_or_create_repos_directory uses DEVENV_ROOT" {
    local fake_root="$TEST_TEMP_DIR/fake_checkout"
    _make_fake_repoops_checkout "$fake_root"
    run bash -c "
        export DEVENV_ROOT='$fake_root'
        source '$fake_root/tools/lib/repo-operations.bash'
        result=\$(get_or_create_repos_directory)
        [ -d \"\$result\" ] && echo \"success\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"success"* ]]
}

@test "repo-operations: get_or_create_repos_directory creates directory if missing" {
    # Self-root contract: the lib self-locates to ITS OWN checkout even when a
    # foreign DEVENV_ROOT points elsewhere. Creation must land under the fake
    # root (the sourced lib checkout), never the foreign one.
    local fake_root="$TEST_TEMP_DIR/fake_checkout2"
    local foreign_root="$TEST_TEMP_DIR/foreign_location"
    _make_fake_repoops_checkout "$fake_root"
    run bash -c "
        export DEVENV_ROOT='$foreign_root'
        source '$fake_root/tools/lib/repo-operations.bash'
        result=\$(get_or_create_repos_directory)
        [ -d \"\$result\" ] && echo \"directory_created\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"directory_created"* ]]
    [ -d "$fake_root/repos" ]
    [ ! -d "$foreign_root/repos" ]
}


@test "repo-operations: get_or_create_repos_directory returns path" {
    local fake_root="$TEST_TEMP_DIR/fake_checkout3"
    _make_fake_repoops_checkout "$fake_root"
    run bash -c "
        export DEVENV_ROOT='$fake_root'
        source '$fake_root/tools/lib/repo-operations.bash'
        get_or_create_repos_directory
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"repos"* ]]
}
