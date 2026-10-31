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

@test "scripts have no stale Azure DevOps references outside the azure provider" {
  # Azure is a supported provider (#40): key-update-azure legitimately
  # references it. Forbidden: Azure vocabulary in provider-unrelated scripts.
  run bash -c "grep -ril 'Azure DevOps\\|azure-devops\\|AzDO' '$PROJECT_ROOT/tools/ts/' '$PROJECT_ROOT/tools/lib/domain/' '$PROJECT_ROOT/tools/lib/core/' 2>/dev/null | grep -vE 'providers/azure|providers/github|domain/fork/'"
  [ "$status" -ne 0 ]
}

@test "scripts have no Azure PAT references outside the azure provider" {
  run bash -c "grep -ril 'AZURE.*TOKEN.*PAT\\|AZURE_DEVOPS_PAT' '$PROJECT_ROOT/tools/ts/' '$PROJECT_ROOT/tools/lib/domain/' '$PROJECT_ROOT/tools/lib/core/' 2>/dev/null | grep -vE 'providers/azure|providers/github|domain/fork/'"
  [ "$status" -ne 0 ]
}

@test "scripts have no work item references outside the azure provider" {
  # Azure work-item mapping lives in the provider domain modules; wrappers
  # stay transport-blind.
  run bash -c "grep -rilE 'wiql|workitemsbatch|azureHttp|dev\.azure\.com' '$PROJECT_ROOT/tools/ts/' '$PROJECT_ROOT/tools/lib/domain/' '$PROJECT_ROOT/tools/lib/core/' 2>/dev/null | grep -vE 'providers/azure|providers/github|domain/fork/'"
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
  # DEVENV markers are tracked temporaries governed by devenv-marker-check,
  # not stale comments — excluded from this stale-comment gate.
  run bash -c "grep -i 'can be deleted later\|TODO\|FIXME' '$PROJECT_ROOT/tools/lib/'*.bash | grep -v 'DEVENV\['"
  [ "$status" -ne 0 ]
}

