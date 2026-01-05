#!/usr/bin/env bats
# Tests for lib/git-config.bash

bats_require_minimum_version 1.5.0

load ../test_helper

@test "git-config library can be sourced" {
    run bash -c "source $PROJECT_ROOT/tools/lib/git-config.bash && echo 'loaded'"
    [ "$status" -eq 0 ]
    [[ "$output" =~ loaded ]]
}

@test "configure_git_repo sets local repository settings" {
    local test_repo="$TEST_TEMP_DIR/test-repo"
    create_mock_git_repo "$test_repo"

    run bash -c "source $PROJECT_ROOT/tools/lib/git-config.bash && configure_git_repo '$test_repo'"
    [ "$status" -eq 0 ]

    cd "$test_repo"
    [ "$(git config core.autocrlf)" = "false" ]
    [ "$(git config core.eol)" = "lf" ]
    [ "$(git config pull.ff)" = "only" ]
}

@test "configure_git_repo adds directory to safe.directory" {
    local test_repo="$TEST_TEMP_DIR/test-repo"
    create_mock_git_repo "$test_repo"

    run bash -c "source $PROJECT_ROOT/tools/lib/git-config.bash && configure_git_repo '$test_repo'"
    [ "$status" -eq 0 ]
    git config --global --get-all safe.directory | grep -q "$test_repo"
}

@test "configure_git_repo updates remote URL when provided" {
    local test_repo="$TEST_TEMP_DIR/test-repo"
    create_mock_git_repo "$test_repo"
    local test_url="https://example.com/test.git"

    run bash -c "source $PROJECT_ROOT/tools/lib/git-config.bash && configure_git_repo '$test_repo' '$test_url'"
    [ "$status" -eq 0 ]
    cd "$test_repo"
    [ "$(git remote get-url origin)" = "$test_url" ]
}

@test "configure_git_repo works with current directory" {
    local test_repo="$TEST_TEMP_DIR/test-repo"
    create_mock_git_repo "$test_repo"
    cd "$test_repo"

    run bash -c "source $PROJECT_ROOT/tools/lib/git-config.bash && configure_git_repo"
    [ "$status" -eq 0 ]
    [ "$(git config core.autocrlf)" = "false" ]
}

@test "configure_git_global sets global git configuration" {
    run bash -c "source $PROJECT_ROOT/tools/lib/git-config.bash && configure_git_global 'Test User' 'test@example.com'"
    [ "$status" -eq 0 ]

    [ "$(git config --global core.autocrlf)" = "false" ]
    [ "$(git config --global core.eol)" = "lf" ]
    [ "$(git config --global pull.ff)" = "only" ]
    [ "$(git config --global push.autoSetupRemote)" = "true" ]
    [ "$(git config --global core.editor)" = "code --wait" ]
    [ "$(git config --global user.name)" = "Test User" ]
    [ "$(git config --global user.email)" = "test@example.com" ]
    [ "$(git config --global merge.tool)" = "vscode" ]
    [ "$(git config --global diff.tool)" = "vscode" ]
}

@test "configure_git_global works without user identity" {
    run bash -c "source $PROJECT_ROOT/tools/lib/git-config.bash && configure_git_global"
    [ "$status" -eq 0 ]
    run git config --global user.name
    [ "$status" -eq 1 ]
}

@test "add_git_safe_directory adds path to safe list" {
    local test_dir="$TEST_TEMP_DIR/safe-test"
    mkdir -p "$test_dir"

    run bash -c "source $PROJECT_ROOT/tools/lib/git-config.bash && add_git_safe_directory '$test_dir'"
    [ "$status" -eq 0 ]
    git config --global --get-all safe.directory | grep -q "$test_dir"
}

@test "add_git_safe_directory does not duplicate entries" {
    local test_dir="$TEST_TEMP_DIR/safe-test"
    mkdir -p "$test_dir"

    run bash -c "source $PROJECT_ROOT/tools/lib/git-config.bash && add_git_safe_directory '$test_dir'"
    run bash -c "source $PROJECT_ROOT/tools/lib/git-config.bash && add_git_safe_directory '$test_dir'"

    local count
    count=$(git config --global --get-all safe.directory | grep -c "$test_dir" || true)
    [ "$count" -eq 1 ]
}

@test "add_git_safe_directory uses current directory by default" {
    local test_dir="$TEST_TEMP_DIR/current"
    mkdir -p "$test_dir"
    cd "$test_dir"

    run bash -c "source $PROJECT_ROOT/tools/lib/git-config.bash && add_git_safe_directory"
    [ "$status" -eq 0 ]
    git config --global --get-all safe.directory | grep -q "$test_dir"
}
