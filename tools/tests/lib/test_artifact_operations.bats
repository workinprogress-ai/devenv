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

@test "query_packages: requires owner argument or GH_ORG" {
  run bash -c "
    unset GH_ORG
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    query_packages
  "
  [ "$status" -ne 0 ]
  [[ "$output" =~ "owner is required" ]]
}

@test "query_packages: uses GH_ORG when owner not provided" {
  run bash -c "
    export GH_ORG='test-org'
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    # Mock gh to produce an error so we can verify owner was set
    gh() { echo 'HTTP 401: Unauthorized' >&2; return 1; }
    export -f gh
    query_packages --type npm 2>&1 || true
  "
  # Should fail trying to query packages, not fail validation
  [[ "$output" =~ "GitHub API error" ]]
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

@test "get_package_versions: uses GH_ORG when owner not provided" {
  run bash -c "
    export GH_ORG='test-org'
    source '$PROJECT_ROOT/tools/lib/artifact-operations.bash'
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    # Mock gh to produce an error so we can verify owner was set
    gh() { echo 'HTTP 401: Unauthorized' >&2; return 1; }
    export -f gh
    get_package_versions --type npm --name my-pkg 2>&1 || true
  "
  # Should fail trying to query versions, not fail validation
  [[ "$output" =~ "GitHub API error" ]]
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
