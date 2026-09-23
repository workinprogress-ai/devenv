#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load ../test_helper

# ============================================================================
# get_full_repo_name Tests
# ============================================================================

@test "get_full_repo_name: requires repo path argument" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    get_full_repo_name ''
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Repository path is required" ]]
}

@test "get_full_repo_name: fails on invalid path" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    cancel_branch_workflow_runs '' 'main'
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Repository and branch required" ]]
}

@test "cancel_branch_workflow_runs: requires branch argument" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
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
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    cancel_branch_workflow_runs 'owner/repo' 'my-branch'
  "
  [ "$status" -eq 0 ]
}

# ============================================================================
# ensure_label Tests
# ============================================================================

@test "ensure_label: requires label argument" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    ensure_label ''
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Label name required" ]]
}

@test "ensure_label: does not create label when it already exists" {
  run bash -c "
    gh() {
      if [[ \"\$*\" =~ 'label list' ]]; then
        echo 'automated'
        return 0
      fi
      echo 'UNEXPECTED_GH_CALL' >&2
      return 1
    }
    export -f gh
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    ensure_label 'automated'
  "
  [ "$status" -eq 0 ]
  [[ ! "$output" =~ "UNEXPECTED_GH_CALL" ]]
}

@test "ensure_label: creates label when it does not exist" {
  run bash -c "
    CREATED=0
    gh() {
      if [[ \"\$*\" =~ 'label list' ]]; then
        echo 'some-other-label'
        return 0
      fi
      if [[ \"\$*\" =~ 'label create' ]]; then
        echo 'CREATED'
        return 0
      fi
      return 0
    }
    export -f gh
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    ensure_label 'automated'
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ "CREATED" ]]
}

@test "ensure_label: succeeds even if label create fails" {
  run bash -c "
    gh() {
      if [[ \"\$*\" =~ 'label list' ]]; then
        return 0
      fi
      if [[ \"\$*\" =~ 'label create' ]]; then
        return 1
      fi
      return 0
    }
    export -f gh
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    ensure_label 'automated'
  "
  [ "$status" -eq 0 ]
}

@test "get_repo_owner: policy org wins before gh fallback; gh consulted when policy unresolvable" {
  create_mock_git_repo "$TEST_TEMP_DIR/owner-repo"
  cd "$TEST_TEMP_DIR/owner-repo" || exit 1

  gh() {
    for arg in "$@"; do
      [[ "$arg" == "-R" ]] && return 1
    done
    echo "test-org"
    return 0
  }
  export -f gh

  # Policy chain resolves from config first: config org must beat the gh
  # fallback without ever passing -R.
  run bash -c "
    export -f gh
    unset GH_ORG POLICY_ORG
    printf '[organization]\nname=t\ngithub_org=config-org\n' > '$TEST_TEMP_DIR/devenv.config'
    export DEVENV_ROOT='$TEST_TEMP_DIR'
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    get_repo_owner
  "
  cd "$ORIGINAL_PWD" || true
  [ "$status" -eq 0 ]
  [ "$output" = "config-org" ]
}

# ============================================================================
# resolve_target_repo behavior locks: the resolution chain, the GH_REPO
# export hand-off to child gh processes, and the safety-gate semantics are
# stable regardless of which layer performs the read.
# ============================================================================

@test "resolve_target_repo: explicit argument wins over env and cwd" {
  create_mock_git_repo "$TEST_TEMP_DIR/owner-repo"
  run bash -c "
    set -e
    export PROJECT_ROOT='$PROJECT_ROOT'
    export DEVENV_ROOT='$TEST_TEMP_DIR'
    unset GITHUB_REPO GH_REPO
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/git-operations.bash'
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    cd '$TEST_TEMP_DIR/owner-repo'
    ALLOW_DEVENV_REPO=0 resolve_target_repo 'arg-org/arg-repo'
  "
  [ "$status" -eq 0 ]
  [ "$output" = "arg-org/arg-repo" ]
}

@test "resolve_target_repo: GITHUB_REPO env used when no argument" {
  run bash -c "
    set -e
    export PROJECT_ROOT='$PROJECT_ROOT'
    export DEVENV_ROOT='$TEST_TEMP_DIR'
    unset GH_REPO
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/git-operations.bash'
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    GITHUB_REPO='env-org/env-repo' resolve_target_repo
  "
  [ "$status" -eq 0 ]
  [ "$output" = "env-org/env-repo" ]
}

@test "resolve_target_repo: exports GH_REPO for child gh env resolution" {
  run bash -c "
    set -e
    export PROJECT_ROOT='$PROJECT_ROOT'
    export DEVENV_ROOT='$TEST_TEMP_DIR'
    unset GITHUB_REPO GH_REPO
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/git-operations.bash'
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    GITHUB_REPO='env-org/env-repo' resolve_target_repo > /dev/null
    printf '%s' \"\${GH_REPO:-}\"
  "
  [ "$status" -eq 0 ]
  [ "$output" = "env-org/env-repo" ]
}

@test "resolve_target_repo: falls back to org + git root basename" {
  create_mock_git_repo "$TEST_TEMP_DIR/cwd-repo"
  run bash -c "
    set -e
    export PROJECT_ROOT='$PROJECT_ROOT'
    unset GITHUB_REPO GH_REPO GH_ORG POLICY_ORG
    printf '[organization]\nname=t\ngithub_org=cfg-org\n' > '$TEST_TEMP_DIR/devenv.config'
    export DEVENV_ROOT='$TEST_TEMP_DIR'
    # Pre-seal the self-root contract so the test-scoped DEVENV_ROOT wins
    # over self-location (git-operations would otherwise re-root to the
    # repo checkout and bind its config).
    export DEVENV_ROOT_SET=1
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/git-operations.bash'
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    cd '$TEST_TEMP_DIR/cwd-repo'
    resolve_target_repo
  "
  [ "$status" -eq 0 ]
  [ "$output" = "cfg-org/cwd-repo" ]
}

@test "resolve_target_repo: exits nonzero when nothing resolvable" {
  run bash -c "
    set -e
    export PROJECT_ROOT='$PROJECT_ROOT'
    export DEVENV_ROOT='$TEST_TEMP_DIR'
    export DEVENV_ROOT_SET=1
    unset GITHUB_REPO GH_REPO GH_ORG POLICY_ORG
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/git-operations.bash'
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    cd '$TEST_TEMP_DIR'
    resolve_target_repo
  "
  [ "$status" -ne 0 ]
}

@test "resolve_target_repo: hard error when git-operations not sourced (gate bypass protection)" {
  run bash -c "
    set -e
    export PROJECT_ROOT='$PROJECT_ROOT'
    export DEVENV_ROOT='$TEST_TEMP_DIR'
    unset GITHUB_REPO GH_REPO
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    GITHUB_REPO='env-org/env-repo' resolve_target_repo
  "
  [ "$status" -ne 0 ]
}

@test "resolve_target_repo: nested devenv clone below repos/ is auto-allowed" {
  create_mock_git_repo "$TEST_TEMP_DIR/ws/repos/cwd-repo"
  run bash -c "
    set -e
    export PROJECT_ROOT='$PROJECT_ROOT'
    unset GITHUB_REPO GH_REPO GH_ORG POLICY_ORG
    printf '[organization]\nname=t\ngithub_org=cfg-org\n' > '$TEST_TEMP_DIR/devenv.config'
    export DEVENV_ROOT='$TEST_TEMP_DIR'
    export DEVENV_ROOT_SET=1
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/git-operations.bash'
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    cd '$TEST_TEMP_DIR/ws/repos/cwd-repo'
    # is_devenv_repo keys on .devcontainer/bootstrap.sh (or a repo literally
    # named devenv); emulate the nested devenv-clone layout with its marker.
    mkdir -p .devcontainer && touch .devcontainer/bootstrap.sh
    resolve_target_repo
  "
  [ "$status" -eq 0 ]
  [ "$output" = "cfg-org/cwd-repo" ]
}
