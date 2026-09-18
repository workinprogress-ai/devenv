#!/usr/bin/env bats
# Contract tests for the github projects + org facades. The AC-3 deliverable
# lives here: GH-only capability failure-path
# tests (provider_require_capability degradation) for projects, rulesets,
# and native issue-types.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

assert_success() {
    [ "$status" -eq 0 ]
}

assert_failure() {
    [ "$status" -ne 0 ]
}

setup() {
    test_helper_setup
    export STUB_CALL_LOG
    export TEST_TEMP_DIR
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    unset _PROVIDER_CORE_LOADED
    unset PROVIDER_NAME
    unset PROVIDER_CAPABILITIES
    stub_gh
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    provider_detect "$TEST_TEMP_DIR/absent.config"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/issues.bash"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/projects.bash"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/org.bash"
}

# ============================================================================
# Capability registration
# ============================================================================

@test "projects module: registers project-boards capability" {
    provider_has_capability project-boards
}

@test "org module: registers rulesets and native-issue-types capabilities" {
    provider_has_capability rulesets
    provider_has_capability native-issue-types
}

# ============================================================================
# AC-3 failure path: projects degrade with the defined error
# ============================================================================

@test "AC-3: projects_list without project-boards capability fails defined, no gh call" {
    PROVIDER_CAPABILITIES=""  # simulate a provider without boards
    run provider_projects_list org/repo
    assert_failure
    [[ "$output" == *"provider 'github' does not support capability 'project-boards'"* ]]
    [[ "$(stub_call_count gh)" -eq 0 ]]
}

@test "AC-3: projects_item_add gated before any gh call" {
    PROVIDER_CAPABILITIES=""
    run provider_projects_item_add org/repo 12 https://github.com/org/repo/issues/99
    assert_failure
    [[ "$(stub_call_count gh)" -eq 0 ]]
}

@test "AC-3: projects_field_list gated before any gh call" {
    PROVIDER_CAPABILITIES=""
    run provider_projects_field_list org/repo 12
    assert_failure
    [[ "$(stub_call_count gh)" -eq 0 ]]
}

# ============================================================================
# AC-3 failure path: rulesets degrade with the defined error
# ============================================================================

@test "AC-3: rulesets_list without rulesets capability fails defined, no gh call" {
    PROVIDER_CAPABILITIES=""
    run provider_org_rulesets_list org/repo
    assert_failure
    [[ "$output" == *"provider 'github' does not support capability 'rulesets'"* ]]
    [[ "$(stub_call_count gh)" -eq 0 ]]
}

@test "AC-3: ruleset_update gated before any gh call" {
    PROVIDER_CAPABILITIES=""
    run provider_org_ruleset_update org/repo 7 /dev/null
    assert_failure
    [[ "$(stub_call_count gh)" -eq 0 ]]
}

# ============================================================================
# AC-3 failure path: native issue-types degrade with the defined error
# ============================================================================

@test "AC-3: org_issue_types without native-issue-types capability fails defined" {
    PROVIDER_CAPABILITIES=""
    run provider_org_issue_types myorg
    assert_failure
    [[ "$output" == *"provider 'github' does not support capability 'native-issue-types'"* ]]
    [[ "$(stub_call_count gh)" -eq 0 ]]
}

# ============================================================================
# Happy paths (GitHub provider with capabilities declared)
# ============================================================================

@test "projects list: gh project list with -R when capability present" {
    run provider_projects_list org/repo
    assert_success
    grep -q "^gh project list -R org/repo$" "$STUB_CALL_LOG"
}

@test "projects item-add: project number, repo, and item url wired" {
    run provider_projects_item_add org/repo 12 https://github.com/org/repo/issues/99
    assert_success
    grep -q "^gh project item-add 12 -R org/repo --url https://github.com/org/repo/issues/99$" "$STUB_CALL_LOG"
}

@test "projects field-list: project number and repo wired" {
    run provider_projects_field_list org/repo 12
    assert_success
    grep -q "^gh project field-list 12 -R org/repo$" "$STUB_CALL_LOG"
}

@test "rulesets list: paginated REST endpoint with capability present" {
    run provider_org_rulesets_list org/repo
    assert_success
    grep -q "^gh api repos/org/repo/rulesets --paginate$" "$STUB_CALL_LOG"
}

@test "ruleset get: id wired into the endpoint" {
    run provider_org_ruleset_get org/repo 42
    assert_success
    grep -q "^gh api repos/org/repo/rulesets/42$" "$STUB_CALL_LOG"
}

@test "ruleset create: payload file wired via --input POST" {
    export STUB_GH_MUTATIONS="$TEST_TEMP_DIR/mutations.log"
    echo '{}' > "$TEST_TEMP_DIR/payload.json"
    run provider_org_ruleset_create org/repo "$TEST_TEMP_DIR/payload.json"
    assert_success
    grep -q "POST" "$STUB_GH_MUTATIONS"
}

@test "org issue types: GraphQL query issued with org interpolated" {
    run provider_org_issue_types myorg
    assert_success
    grep -q "gh api graphql" "$STUB_CALL_LOG"
}

@test "releases list: -R form, ungated (portable domain)" {
    run provider_org_releases_list org/repo --limit 5
    assert_success
    grep -q "^gh release list -R org/repo --limit 5$" "$STUB_CALL_LOG"
}

@test "releases list: works even when rulesets capability is stripped (portable)" {
    PROVIDER_CAPABILITIES=""
    run provider_org_releases_list org/repo
    assert_success
    grep -q "^gh release list -R org/repo$" "$STUB_CALL_LOG"
}
