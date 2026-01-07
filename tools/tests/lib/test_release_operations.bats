#!/usr/bin/env bats

setup() {
  export DEVENV_ROOT="/workspaces/devenv"
  load "${DEVENV_ROOT}/tools/tests/test_helper"
}

# Test get_latest_version_tag
@test "get_latest_version_tag with existing tags" {
  cd "$(mktemp -d)"
  git init >/dev/null 2>&1
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "test" > file.txt
  git add file.txt
  git commit -m "Initial commit" >/dev/null 2>&1
  
  git tag v1.0.0 >/dev/null 2>&1
  git tag v1.1.0 >/dev/null 2>&1
  git tag v2.0.0 >/dev/null 2>&1
  
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  result=$(get_latest_version_tag)
  
  [[ "$result" == "v2.0.0" ]]
}

# Test parse_semver
@test "parse_semver with basic version" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  result=$(parse_semver "1.2.3")
  
  [[ "$result" == "1 2 3" ]]
}

@test "parse_semver with v prefix" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  result=$(parse_semver "v1.2.3")
  
  [[ "$result" == "1 2 3" ]]
}

# Test validate_semver
@test "validate_semver with valid version" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  validate_semver "1.2.3"
  [[ $? -eq 0 ]]
}

@test "validate_semver with invalid version" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  ! validate_semver "not.a.version"
}

# Test bump_semver
@test "bump_semver patch" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  result=$(bump_semver "1.2.3" "patch")
  
  [[ "$result" == "1.2.4" ]]
}

@test "bump_semver minor" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  result=$(bump_semver "1.2.3" "minor")
  
  [[ "$result" == "1.3.0" ]]
}

@test "bump_semver major" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  result=$(bump_semver "1.2.3" "major")
  
  [[ "$result" == "2.0.0" ]]
}

# Test is_breaking_commit
@test "is_breaking_commit with breaking header" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  msg="feat!: breaking change"
  is_breaking_commit "$msg"
  [[ $? -eq 0 ]]
}

@test "is_breaking_commit with BREAKING footer" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  msg=$'feat: new feature\n\nBREAKING CHANGE: this breaks stuff'
  is_breaking_commit "$msg"
  [[ $? -eq 0 ]]
}

@test "is_breaking_commit non-breaking" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  msg="feat: normal feature"
  ! is_breaking_commit "$msg"
}

# Test is_feature_commit
@test "is_feature_commit with feature header" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  is_feature_commit "feat: new feature"
  [[ $? -eq 0 ]]
}

@test "is_feature_commit non-feature" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  ! is_feature_commit "fix: bug fix"
}

# Test is_fix_commit
@test "is_fix_commit with fix header" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  is_fix_commit "fix: bug fix"
  [[ $? -eq 0 ]]
}

@test "is_fix_commit with perf header" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  is_fix_commit "perf: optimization"
  [[ $? -eq 0 ]]
}

# Test commit_bump_from_header
@test "commit_bump_from_header breaking" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  result=$(commit_bump_from_header "feat!: breaking change")
  
  [[ "$result" == "major" ]]
}

@test "commit_bump_from_header feature" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  result=$(commit_bump_from_header "feat: new feature")
  
  [[ "$result" == "minor" ]]
}

@test "commit_bump_from_header fix" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  result=$(commit_bump_from_header "fix: bug")
  
  [[ "$result" == "patch" ]]
}

# Test strip_version_prefix
@test "strip_version_prefix with v" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  result=$(strip_version_prefix "v1.2.3")
  
  [[ "$result" == "1.2.3" ]]
}

@test "strip_version_prefix without prefix" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  result=$(strip_version_prefix "1.2.3")
  
  [[ "$result" == "1.2.3" ]]
}

# Test compare_versions
@test "compare_versions equal" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  result=$(compare_versions "1.2.3" "1.2.3")
  
  [[ "$result" == "0" ]]
}

@test "compare_versions first less than second" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  result=$(compare_versions "1.2.3" "1.2.4")
  
  [[ "$result" == "-1" ]]
}

@test "compare_versions first greater than second" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  result=$(compare_versions "1.2.4" "1.2.3")
  
  [[ "$result" == "1" ]]
}

# Test library exports
@test "all release-operations functions are exported" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  
  declare -f get_latest_version_tag >/dev/null
  declare -f parse_semver >/dev/null
  declare -f validate_semver >/dev/null
  declare -f bump_semver >/dev/null
  declare -f is_breaking_commit >/dev/null
}

@test "release-operations library loads without errors" {
  source "${DEVENV_ROOT}/tools/lib/release-operations.bash"
  [[ -n "$_RELEASE_OPERATIONS_LOADED" ]]
}
