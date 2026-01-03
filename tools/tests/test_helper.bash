#!/usr/bin/env bash
# Test helper functions

# Common setup for tests
test_helper_setup() {
    # Create temporary test directory
    export TEST_TEMP_DIR="$(mktemp -d)"
    export ORIGINAL_PWD="$PWD"
    
    # Source the project root (go up two levels from tools/tests to workspace root)
    export PROJECT_ROOT="${BATS_TEST_DIRNAME}/../.."
    export DEVENV_ROOT="$PROJECT_ROOT"
    export devenv="$PROJECT_ROOT"
    export DEVENV_TOOLS="$DEVENV_ROOT/tools"
    
    # Set up test environment variables
    export GH_USER="test-user"
    export GH_ORG="test-org"
    export GH_TOKEN="ghp_test1234567890abcdefghijklmnopqrstuvwxyz"
    export USER_EMAIL="test@workinprogress.ai"
    export HUMAN_NAME="Test User"
    export DEVENV_ROOT="$PROJECT_ROOT"
    export HOME="$TEST_TEMP_DIR"
}

setup() {
    test_helper_setup
}

# Common teardown for tests
test_helper_teardown() {
    # Clean up test directory
    if [ -d "$TEST_TEMP_DIR" ]; then
        rm -rf "$TEST_TEMP_DIR"
    fi
    
    # Return to original directory
    cd "$ORIGINAL_PWD" 2>/dev/null || true
}

teardown() {
    test_helper_teardown
}

# Helper function to create a mock git repository
create_mock_git_repo() {
    local repo_path="$1"
    mkdir -p "$repo_path"
    cd "$repo_path"
    git init
    git config user.email "test@example.com"
    git config user.name "Test User"
    
    # Add a dummy origin remote
    git remote add origin "git@github.com:test-org/dummy.git"
    
    touch README.md
    git add README.md
    git commit -m "Initial commit"
    git branch -M main
    cd "$ORIGINAL_PWD"
}

# Helper to check if a function exists
function_exists() {
    declare -f -F "$1" > /dev/null
    return $?
}
