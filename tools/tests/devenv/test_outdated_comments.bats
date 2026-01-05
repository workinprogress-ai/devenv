#!/usr/bin/env bats
# Tests for outdated comments and code cleanup

bats_require_minimum_version 1.5.0

load ../test_helper

@test "bootstrap.sh has valid syntax" {
  run bash -n "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -eq 0 ]
}

@test "bootstrap.sh has no 'can be deleted later' comments" {
  run grep -i "can be deleted later" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -ne 0 ]
}

@test "bootstrap.sh has no 'TODO' comments" {
  run grep -i "# TODO" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -ne 0 ]
}

@test "bootstrap.sh has no 'FIXME' comments" {
  run grep -i "# FIXME" "$PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -ne 0 ]
}

@test "scripts have no Azure DevOps references in comments" {
  run grep -ri "Azure DevOps\|azure-devops\|AzDO" "$PROJECT_ROOT/tools/scripts/" --include="*.sh"
  [ "$status" -ne 0 ]
}

@test "scripts have no Azure PAT references" {
  run grep -ri "AZURE.*TOKEN.*PAT\|AZURE_DEVOPS_PAT" "$PROJECT_ROOT/tools/scripts/" --include="*.sh"
  [ "$status" -ne 0 ]
}

@test "scripts have no work item references in active code" {
  # Allow in docs but not in active scripts
  run grep -r "work.*item\|workitem" "$PROJECT_ROOT/tools/scripts/" --include="*.sh" -i
  [ "$status" -ne 0 ]
}

@test "no commented-out large code blocks in bootstrap" {
  # Check for blocks with more than 3 consecutive commented lines
  run bash -c "awk '/^#[^!]/{c++; if(c>3) exit 0} c>0 && !/^#/{c=0} END{exit 1}' $PROJECT_ROOT/.devcontainer/bootstrap.sh"
  [ "$status" -ne 0 ]
}

@test "container-start.sh has no outdated comments" {
  run grep -i "can be deleted later\|TODO\|FIXME" "$PROJECT_ROOT/.devcontainer/container-start.sh"
  [ "$status" -ne 0 ]
}

@test "startup.sh has no outdated comments" {
  run grep -i "can be deleted later\|TODO\|FIXME" "$PROJECT_ROOT/.devcontainer/startup.sh"
  [ "$status" -ne 0 ]
}

@test "lib files have no outdated comments" {
  run grep -i "can be deleted later\|TODO\|FIXME" "$PROJECT_ROOT/tools/lib/"*.bash
  [ "$status" -ne 0 ]
}

@test "no commented-out code in key scripts" {
  # Check that key scripts don't have extensive commented-out code
  local key_scripts=(
    "$PROJECT_ROOT/tools/scripts/repo-get.sh"
    "$PROJECT_ROOT/tools/scripts/repo-update-all.sh"
    "$PROJECT_ROOT/tools/scripts/pr-complete-merge.sh"
  )
  
  for script in "${key_scripts[@]}"; do
    if [ -f "$script" ]; then
      # Should have fewer than 5 consecutive commented lines
      run bash -c "awk '/^[[:space:]]*#[^!]/{c++; if(c>5) exit 0} c>0 && !/^[[:space:]]*#/{c=0} END{exit 1}' $script"
      [ "$status" -ne 0 ] || {
        echo "Script $script has too many consecutive commented lines"
        return 1
      }
    fi
  done
}
