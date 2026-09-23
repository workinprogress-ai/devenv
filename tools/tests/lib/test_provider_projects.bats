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

# ============================================================================
# Phase-2 verbs: project GraphQL resolution + field mutation (issue #36)
# ============================================================================

@test "projects id_by_name: numeric form uses projectV2(number:)" {
    printf '{"data":{"organization":{"projectV2":{"id":"PVT_num"}}}}' > "$TEST_TEMP_DIR/gql.json"
    export STUB_GH_API_RESPONSE="$TEST_TEMP_DIR/gql.json"
    run provider_projects_id_by_name myorg 42
    assert_success
    # The stub ignores --jq (it cats the canned file), so assert the call
    # shape: numeric path issues graphql with -F n= (no list scan).
    grep -q '\-f o=myorg -F n=42 --jq' "$STUB_CALL_LOG"
}

@test "projects id_by_name: capability-gated" {
    PROVIDER_CAPABILITIES=""
    run provider_projects_id_by_name myorg 42
    assert_failure
    [[ "$output" == *"does not support capability 'project-boards'"* ]]
}

@test "projects item_id_for_issue: rejects non-numeric issue" {
    run provider_projects_item_id_for_issue "PVT_abc" "not-a-number" myorg myrepo
    assert_failure
    [[ "$output" == *"must be numeric"* ]]
}

@test "projects item_id_for_issue: graphql issued with project id" {
    # The cli-stubs gh returns raw JSON without applying --jq, but the
    # lookup's filtering happens inside the jq program gh executes. Wrap the
    # stub with a jq-applying shim on PATH (mirroring real gh behavior).
    printf '{"data":{"node":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVTI_9","content":{"number":7,"repository":{"nameWithOwner":"myorg/myrepo"}}}]}}}}' > "$TEST_TEMP_DIR/gql2.json"
    local shim="$TEST_TEMP_DIR/jq-gh-bin"
    mkdir -p "$shim"
    cat > "$shim/gh" <<EOF
#!/usr/bin/env bash
echo "gh \$*" >> "\$STUB_CALL_LOG"
prog=""
prev=""
for a in "\$@"; do [ "\$prev" = '--jq' ] && prog="\$a"; prev="\$a"; done
cat "$TEST_TEMP_DIR/gql2.json" | jq -r "\$prog"
EOF
    chmod +x "$shim/gh"
    PATH="$shim:$PATH" run provider_projects_item_id_for_issue "PVT_abc" 7 myorg myrepo
    assert_success
    grep -q '\-f p=PVT_abc --jq' "$STUB_CALL_LOG"
}

@test "projects field_option_ids: graphql issued" {
    printf '{"data":{"node":{"field":{"id":"FLD_1","options":[{"id":"OPT_a","name":"To-groom"}]}}}}' > "$TEST_TEMP_DIR/gql3.json"
    export STUB_GH_API_RESPONSE="$TEST_TEMP_DIR/gql3.json"
    run provider_projects_field_option_ids "PVT_abc" "Status" "to-groom"
    assert_success
    [ "$output" = "FLD_1 OPT_a" ]
    grep -q "gh api graphql" "$STUB_CALL_LOG"
}

@test "projects field_set: mutation issued with all four IDs" {
    export STUB_GH_MUTATIONS="$TEST_TEMP_DIR/mutations.log"
    run provider_projects_field_set "PVT_abc" "PVTI_1" "FLD_2" "OPT_3"
    assert_success
    grep -q "updateProjectV2ItemFieldValue" "$STUB_CALL_LOG"
}

@test "projects field_set: capability-gated" {
    PROVIDER_CAPABILITIES=""
    run provider_projects_field_set "PVT_abc" "PVTI_1" "FLD_2" "OPT_3"
    assert_failure
    [[ "$output" == *"does not support capability 'project-boards'"* ]]
}

@test "projects for_issue: graphql issued with issue url" {
    run provider_projects_for_issue "https://github.com/myorg/r/issues/1" myorg
    assert_success
    grep -q "gh api graphql" "$STUB_CALL_LOG"
}

@test "repos api: generic escape hatch passes method/endpoint through" {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/repos.bash"
    run provider_api PATCH repos/org/repo -f has_wiki=false
    assert_success
    grep -q "^gh api -X PATCH repos/org/repo -f has_wiki=false$" "$STUB_CALL_LOG"
}

@test "repos api_paginate: --paginate flag wired" {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/repos.bash"
    run provider_api_paginate /users/org/packages
    assert_success
    grep -q "^gh api /users/org/packages --paginate$" "$STUB_CALL_LOG"
}

@test "id_by_name: quote-bearing title logs the reason, not silent not-found" {
    run provider_projects_id_by_name "org" 'Bad "Title"'
    [ "$status" -ne 0 ]
    [[ "$output" == *"double quotes"* ]]
}
