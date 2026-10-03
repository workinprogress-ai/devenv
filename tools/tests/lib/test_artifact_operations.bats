#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load ../test_helper

# ============================================================================
# get_package_type_id Tests
# ============================================================================

@test "get_package_type_id: normalizes npm variations" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    get_package_type_id 'NPM'
  "
  [ "$status" -eq 0 ]
  [ "$output" = "npm" ]
}

@test "get_package_type_id: normalizes npm (node)" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    get_package_type_id 'node'
  "
  [ "$status" -eq 0 ]
  [ "$output" = "npm" ]
}

@test "get_package_type_id: normalizes javascript" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    get_package_type_id 'javascript'
  "
  [ "$status" -eq 0 ]
  [ "$output" = "npm" ]
}

@test "get_package_type_id: normalizes nuget variations" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    get_package_type_id 'NUGET'
  "
  [ "$status" -eq 0 ]
  [ "$output" = "nuget" ]
}

@test "get_package_type_id: normalizes nuget (.net)" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    get_package_type_id '.net'
  "
  [ "$status" -eq 0 ]
  [ "$output" = "nuget" ]
}

@test "get_package_type_id: normalizes nuget (csharp)" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    get_package_type_id 'csharp'
  "
  [ "$status" -eq 0 ]
  [ "$output" = "nuget" ]
}

@test "get_package_type_id: normalizes docker variations" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    get_package_type_id 'DOCKER'
  "
  [ "$status" -eq 0 ]
  [ "$output" = "docker" ]
}

@test "get_package_type_id: normalizes docker (container)" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    get_package_type_id 'container'
  "
  [ "$status" -eq 0 ]
  [ "$output" = "docker" ]
}

@test "get_package_type_id: normalizes maven (java)" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    get_package_type_id 'java'
  "
  [ "$status" -eq 0 ]
  [ "$output" = "maven" ]
}

@test "get_package_type_id: normalizes ruby (rubygems)" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    get_package_type_id 'ruby'
  "
  [ "$status" -eq 0 ]
  [ "$output" = "rubygems" ]
}

@test "get_package_type_id: returns unknown types as-is" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    get_package_type_id 'custom-type'
  "
  [ "$status" -eq 0 ]
  [ "$output" = "custom-type" ]
}

# ============================================================================
# get_supported_package_types Tests
# ============================================================================

@test "get_supported_package_types: returns list of supported types" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    get_supported_package_types
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ "npm" ]]
  [[ "$output" =~ "nuget" ]]
  [[ "$output" =~ "docker" ]]
  [[ "$output" =~ "maven" ]]
}

# ============================================================================
# is_supported_package_type Tests
# ============================================================================

@test "is_supported_package_type: validates npm" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    is_supported_package_type 'npm'
  "
  [ "$status" -eq 0 ]
}

@test "is_supported_package_type: validates npm variations" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    is_supported_package_type 'node'
  "
  [ "$status" -eq 0 ]
}

@test "is_supported_package_type: validates nuget" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    is_supported_package_type 'nuget'
  "
  [ "$status" -eq 0 ]
}

@test "is_supported_package_type: rejects unsupported type" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    is_supported_package_type 'unknown-package-type'
  "
  [ "$status" -ne 0 ]
}

# Note: format_packages_table, format_versions_table, and format_json have been
# moved to the artifacts-list.sh script since they are specific to that script's
# output formatting needs rather than reusable library functions.

@test "artifact-operations: exports only core API functions" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    declare -F | grep -E '(get_package_type_id|query_packages|get_package_versions)'
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ "get_package_type_id" ]]
  [[ "$output" =~ "query_packages" ]]
  [[ "$output" =~ "get_package_versions" ]]
}

# ============================================================================
# query_packages Tests
# ============================================================================

@test "query_packages: requires owner argument or org policy resolution" {
  run bash -c "
    unset GH_ORG POLICY_ORG
    printf '[organization]\nname=t\n' > '$TEST_TEMP_DIR/empty-org.config'
    export DEVENV_ROOT='$TEST_TEMP_DIR'
    : > '$TEST_TEMP_DIR/no-orgs.config'
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    _policy_dir='$PROJECT_ROOT/tools/lib/policy'
    source "\$_policy_dir/policy-core.bash"
    policy_core_init '$TEST_TEMP_DIR/no-orgs.config'
    source "\$_policy_dir/identity-policy.bash"
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    query_packages
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "owner is required" ]]
}

@test "query_packages: uses configured organization when owner not provided" {
  run bash -c "
    export GH_ORG='conflicting-org'
    unset POLICY_ORG
    export DEVENV_ROOT='$TEST_TEMP_DIR/artifact-root' DEVENV_ROOT_SET=1
    mkdir -p \"\$DEVENV_ROOT\"
    printf '[provider]\\nname=github\\n[organization]\\norg=test-org\\n' > \"\$DEVENV_ROOT/devenv.config\"
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    gh() { printf '%s\\n' \"\$*\" >> '$TEST_TEMP_DIR/gh-args'; echo 'HTTP 401: Unauthorized' >&2; return 1; }
    export -f gh
    query_packages --type npm 2>&1 || true
    cat '$TEST_TEMP_DIR/gh-args'
  "
  [[ "$output" =~ "GitHub API error" ]]
  [[ "$output" == *"/users/test-org/packages"* ]]
  [[ "$output" != *"/users/conflicting-org/packages"* ]]
}

@test "query_packages: rejects unknown options" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    query_packages --owner myorg --invalid-option value
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "Unknown option" ]]
}

# ============================================================================
# get_package_versions Tests
# ============================================================================

@test "get_package_versions: requires owner, type, and name" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    get_package_versions
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "owner" ]]
  [[ "$output" =~ "type" ]]
  [[ "$output" =~ "required" ]]
}

@test "get_package_versions: requires type when owner provided" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    get_package_versions --owner myorg --name mypackage
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "owner" ]]
  [[ "$output" =~ "type" ]]
  [[ "$output" =~ "required" ]]
}

@test "get_package_versions: requires name when owner and type provided" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    get_package_versions --owner myorg --type npm
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "owner" ]]
  [[ "$output" =~ "type" ]]
  [[ "$output" =~ "required" ]]
}

@test "get_package_versions: uses configured organization when owner not provided" {
  run bash -c "
    export GH_ORG='conflicting-org'
    unset POLICY_ORG
    export DEVENV_ROOT='$TEST_TEMP_DIR/artifact-root' DEVENV_ROOT_SET=1
    mkdir -p \"\$DEVENV_ROOT\"
    printf '[provider]\\nname=github\\n[organization]\\norg=test-org\\n' > \"\$DEVENV_ROOT/devenv.config\"
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    gh() { printf '%s\\n' \"\$*\" >> '$TEST_TEMP_DIR/gh-args'; echo 'HTTP 401: Unauthorized' >&2; return 1; }
    export -f gh
    get_package_versions --type npm --name my-pkg 2>&1 || true
    cat '$TEST_TEMP_DIR/gh-args'
  "
  [[ "$output" =~ "GitHub API error" ]]
  [[ "$output" == *"/users/test-org/packages/npm/my-pkg/versions"* ]]
  [[ "$output" != *"/users/conflicting-org/packages"* ]]
}

# ============================================================================
# Module Loading Tests
# ============================================================================

@test "artifact-operations: loads without errors" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
  "
  [ "$status" -eq 0 ]
}

@test "artifact-operations: prevents multiple sourcing" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
  "
  [ "$status" -eq 0 ]
}

@test "artifact-operations: exports functions" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    type -t get_package_type_id
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ "function" ]]
}

# ============================================================================
# Packages domain-verb contract
# ============================================================================

@test "packages reads ride provider domain verbs, never raw provider_api" {
  # The neutral artifact layer must consume provider_org_packages_list (and
  # the versions verb), not github-only provider_api pagination — raw API
  # access fails defined under providers without a REST-equivalent surface.
  local body
  body=$(cat "$PROJECT_ROOT/tools/lib/artifact-operations.bash")
  [[ "$body" != *"provider_api_paginate"* ]] || {
    echo "artifact-operations still calls provider_api_paginate" >&2
    return 1
  }
  [[ "$body" != *"provider_api "* ]] || {
    echo "artifact-operations still calls provider_api" >&2
    return 1
  }
}

@test "github provider implements provider_org_packages_list" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    PROVIDER_NAME=github
    provider_load repos
    type -t provider_org_packages_list
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ "function" ]]
}

@test "azure provider implements provider_org_packages_list" {
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/provider-loader.bash'
    PROVIDER_NAME=azure
    provider_load repos
    type -t provider_org_packages_list
  "
  [ "$status" -eq 0 ]
  [[ "$output" =~ "function" ]]
}
