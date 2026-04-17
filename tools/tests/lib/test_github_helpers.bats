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

# ============================================================================
# wait_for_workflow_runs Tests
# ============================================================================

@test "wait_for_workflow_runs: requires repo argument" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    wait_for_workflow_runs ''
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Repository" ]]
}

@test "wait_for_workflow_runs: returns 0 when no active runs and latest succeeded" {
  run bash -c "
    gh() {
      if [[ \"\$*\" =~ 'status' ]]; then
        echo '0'
      elif [[ \"\$*\" =~ 'conclusion' ]]; then
        echo 'success'
      fi
      return 0
    }
    export -f gh
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    wait_for_workflow_runs 'owner/repo' 'master' 1 5
  "
  [ "$status" -eq 0 ]
}

@test "wait_for_workflow_runs: returns 1 when latest run failed" {
  run bash -c "
    gh() {
      if [[ \"\$*\" =~ 'status' ]]; then
        echo '0'
      elif [[ \"\$*\" =~ 'conclusion' ]]; then
        echo 'failure'
      fi
      return 0
    }
    export -f gh
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    wait_for_workflow_runs 'owner/repo' 'master' 1 5
  "
  [ "$status" -eq 1 ]
}

@test "wait_for_workflow_runs: returns 1 when latest run cancelled" {
  run bash -c "
    gh() {
      if [[ \"\$*\" =~ 'status' ]]; then
        echo '0'
      elif [[ \"\$*\" =~ 'conclusion' ]]; then
        echo 'cancelled'
      fi
      return 0
    }
    export -f gh
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    wait_for_workflow_runs 'owner/repo' 'master' 1 5
  "
  [ "$status" -eq 1 ]
}

@test "wait_for_workflow_runs: returns 2 on timeout with active runs" {
  run bash -c "
    gh() {
      # Always report 1 active run
      if [[ \"\$*\" =~ 'status' ]]; then
        echo '1'
      fi
      return 0
    }
    export -f gh
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    wait_for_workflow_runs 'owner/repo' 'master' 1 2
  "
  [ "$status" -eq 2 ]
  [[ "$output" =~ "Timeout" ]]
}

@test "wait_for_workflow_runs: polls until runs complete then succeeds" {
  local counter_file="$TEST_TEMP_DIR/gh_call_count"
  echo "0" > "$counter_file"

  run bash -c "
    COUNTER_FILE='$counter_file'
    gh() {
      if [[ \"\$*\" =~ 'status' ]]; then
        local count=\$(cat \"\$COUNTER_FILE\")
        count=\$((count + 1))
        echo \"\$count\" > \"\$COUNTER_FILE\"
        if [ \"\$count\" -le 2 ]; then
          echo '1'
        else
          echo '0'
        fi
      elif [[ \"\$*\" =~ 'conclusion' ]]; then
        echo 'success'
      fi
      return 0
    }
    export -f gh
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    wait_for_workflow_runs 'owner/repo' 'master' 1 10
  "
  [ "$status" -eq 0 ]
}

# ============================================================================
# wait_for_workflow_runs_multi Tests
# ============================================================================

@test "wait_for_workflow_runs_multi: returns 0 when all repos succeed" {
  run bash -c "
    gh() {
      if [[ \"\$*\" =~ 'status' ]]; then
        echo '0'
      elif [[ \"\$*\" =~ 'conclusion' ]]; then
        echo 'success'
      fi
      return 0
    }
    export -f gh
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    wait_for_workflow_runs_multi 'master' 1 5 'owner/repo1' 'owner/repo2'
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ "All workflow runs completed" ]]
}

@test "wait_for_workflow_runs_multi: returns 1 when any repo fails" {
  run bash -c "
    gh() {
      if [[ \"\$*\" =~ 'status' ]]; then
        echo '0'
      elif [[ \"\$*\" =~ 'conclusion' ]]; then
        # Fail for repo2
        if [[ \"\$*\" =~ 'repo2' ]]; then
          echo 'failure'
        else
          echo 'success'
        fi
      fi
      return 0
    }
    export -f gh
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    wait_for_workflow_runs_multi 'master' 1 5 'owner/repo1' 'owner/repo2'
  "
  [ "$status" -eq 1 ]
  [[ "$output" =~ "failed or timed out" ]]
}

@test "wait_for_workflow_runs_multi: reports which repos failed" {
  run bash -c "
    gh() {
      if [[ \"\$*\" =~ 'status' ]]; then
        echo '0'
      elif [[ \"\$*\" =~ 'conclusion' ]]; then
        echo 'failure'
      fi
      return 0
    }
    export -f gh
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    wait_for_workflow_runs_multi 'master' 1 5 'owner/repo1' 'owner/repo2'
  "
  [ "$status" -eq 1 ]
  [[ "$output" =~ "owner/repo1" ]]
  [[ "$output" =~ "owner/repo2" ]]
}

# ============================================================================
# cancel_branch_workflow_runs Tests
# ============================================================================

@test "cancel_branch_workflow_runs: requires repo argument" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    cancel_branch_workflow_runs '' 'main'
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Repository and branch required" ]]
}

@test "cancel_branch_workflow_runs: requires branch argument" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    cancel_branch_workflow_runs 'owner/repo' ''
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Repository and branch required" ]]
}

@test "cancel_branch_workflow_runs: returns 0 when no active runs" {
  run bash -c "
    gh() {
      if [[ \"\$*\" =~ 'run list' ]]; then
        echo ''
        return 0
      fi
      return 1
    }
    export -f gh
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    cancel_branch_workflow_runs 'owner/repo' 'my-branch'
  "
  [ "$status" -eq 0 ]
}

@test "cancel_branch_workflow_runs: cancels active runs" {
  local cancel_log="$TEST_TEMP_DIR/cancel_log"
  touch "$cancel_log"

  run bash -c "
    CANCEL_LOG='$cancel_log'
    gh() {
      if [[ \"\$*\" =~ 'run list' ]]; then
        printf '111\n222\n'
        return 0
      elif [[ \"\$*\" =~ 'run cancel' ]]; then
        echo \"\$*\" >> \"\$CANCEL_LOG\"
        return 0
      fi
      return 1
    }
    export -f gh
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    cancel_branch_workflow_runs 'owner/repo' 'my-branch'
  "
  [ "$status" -eq 0 ]
  [[ "$(cat "$cancel_log")" =~ "111" ]]
  [[ "$(cat "$cancel_log")" =~ "222" ]]
}

@test "cancel_branch_workflow_runs: succeeds even if cancel fails" {
  run bash -c "
    gh() {
      if [[ \"\$*\" =~ 'run list' ]]; then
        printf '999\n'
        return 0
      elif [[ \"\$*\" =~ 'run cancel' ]]; then
        return 1
      fi
      return 1
    }
    export -f gh
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/github-helpers.bash'
    cancel_branch_workflow_runs 'owner/repo' 'my-branch'
  "
  [ "$status" -eq 0 ]
}
