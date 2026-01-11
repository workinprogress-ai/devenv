#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load ../test_helper

# ============================================================================
# get_full_repo_name Tests
# ============================================================================

@test "get_full_repo_name: requires repo path argument" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    get_full_repo_name ''
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Repository path is required" ]]
}

@test "get_full_repo_name: fails on invalid path" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    get_full_repo_name '/nonexistent/path/to/repo'
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Failed to change to repository path" ]]
}

@test "get_full_repo_name: uses gh repo view when available" {
  mkdir -p "$TEST_TEMP_DIR/test-repo"
  cd "$TEST_TEMP_DIR/test-repo" || exit 1
  git init -q
  git remote add origin "https://github.com/test-org/test-repo.git"
  
  # Mock gh to return nameWithOwner
  gh() {
    if [[ "$*" =~ "repo view" ]] && [[ "$*" =~ "nameWithOwner" ]]; then
      echo "test-org/test-repo"
      return 0
    fi
    return 1
  }
  
  export -f gh
  
  run bash -c "
    export -f gh
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    get_full_repo_name '$TEST_TEMP_DIR/test-repo'
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ "test-org/test-repo" ]]
}

@test "get_full_repo_name: falls back to git URL parsing when gh fails" {
  mkdir -p "$TEST_TEMP_DIR/test-repo2"
  cd "$TEST_TEMP_DIR/test-repo2" || exit 1
  git init -q
  git remote add origin "https://github.com/my-org/my-project.git"
  
  # Mock gh to fail
  gh() {
    return 1
  }
  
  export -f gh
  
  run bash -c "
    export -f gh
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    get_full_repo_name '$TEST_TEMP_DIR/test-repo2'
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ "my-org/my-project" ]]
}

@test "get_full_repo_name: parses SSH git URLs" {
  mkdir -p "$TEST_TEMP_DIR/test-repo3"
  cd "$TEST_TEMP_DIR/test-repo3" || exit 1
  git init -q
  git remote add origin "git@github.com:org-name/repo-name.git"
  
  # Mock gh to fail, forcing fallback
  gh() {
    return 1
  }
  
  export -f gh
  
  run bash -c "
    export -f gh
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    get_full_repo_name '$TEST_TEMP_DIR/test-repo3'
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ "org-name/repo-name" ]]
}

@test "get_full_repo_name: parses HTTPS git URLs without .git suffix" {
  mkdir -p "$TEST_TEMP_DIR/test-repo4"
  cd "$TEST_TEMP_DIR/test-repo4" || exit 1
  git init -q
  git remote add origin "https://github.com/owner/project"
  
  # Mock gh to fail
  gh() {
    return 1
  }
  
  export -f gh
  
  run bash -c "
    export -f gh
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    get_full_repo_name '$TEST_TEMP_DIR/test-repo4'
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ "owner/project" ]]
}

@test "get_full_repo_name: fails when no git remote found" {
  mkdir -p "$TEST_TEMP_DIR/test-repo5"
  cd "$TEST_TEMP_DIR/test-repo5" || exit 1
  git init -q
  # Don't add remote
  
  # Mock gh to fail
  gh() {
    return 1
  }
  
  export -f gh
  
  run bash -c "
    export -f gh
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    get_full_repo_name '$TEST_TEMP_DIR/test-repo5'
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "No git remote 'origin' found" ]]
}

@test "get_full_repo_name: fails when URL parsing fails" {
  mkdir -p "$TEST_TEMP_DIR/test-repo6"
  cd "$TEST_TEMP_DIR/test-repo6" || exit 1
  git init -q
  git remote add origin "https://invalid-url"
  
  # Mock gh to fail
  gh() {
    return 1
  }
  
  export -f gh
  
  run bash -c "
    export -f gh
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    get_full_repo_name '$TEST_TEMP_DIR/test-repo6'
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Could not parse repository name" ]]
}
