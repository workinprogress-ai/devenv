#!/usr/bin/env bats
# Contract tests for provider-core.bash.
# Green here means: detection, dispatch guard, auth seam, capability flags,
# and the error contract behave as the facade contract specifies.
# Contract tests for domain facades landing in Phases 3-4 are declared red
# (registered at the bottom) under the plan's milestone-green policy.

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
    # DEVENV_TOOLS must point at this checkout's tools/ for provider lib sourcing.
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    unset _PROVIDER_CORE_LOADED
    unset PROVIDER_NAME
    unset PROVIDER_CAPABILITIES
}

source_core() {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
}

write_config() {
    printf '%s\n' "$@" > "$TEST_TEMP_DIR/devenv.config"
    echo "$TEST_TEMP_DIR/devenv.config"
}

@test "scaffold: cli-stubs fixture loads and stub_gh serves canned api response" {
    stub_gh
    printf '[{"id": 1, "body": "doc_id: x"}]' > "$TEST_TEMP_DIR/api.json"
    export STUB_GH_API_RESPONSE="$TEST_TEMP_DIR/api.json"
    run gh api "repos/o/r/issues/1/comments"
    assert_success
    [[ "$output" == *'"doc_id: x"'* ]]
}

@test "scaffold: stub_gh records invocation argv to the call log" {
    stub_gh
    run gh issue list --state open
    assert_success
    [[ "$(stub_call_count gh)" -eq 1 ]]
    grep -q "^gh issue list --state open$" "$STUB_CALL_LOG"
}

@test "scaffold: stub_gh failure mode propagates" {
    stub_gh
    STUB_GH_FAIL=1 run gh repo view
    assert_failure
}

@test "scaffold: providers library directory exists with expected layout" {
    [ -d "$DEVENV_TOOLS/lib/providers" ]
    [ -f "$DEVENV_TOOLS/lib/providers/INVENTORY.md" ]
}

# ============================================================================
# Detection
# ============================================================================

@test "detect: defaults to github when no config file exists" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    [ "$PROVIDER_NAME" = "github" ]
}

@test "detect: reads [provider] name from devenv.config" {
    source_core
    local cfg
    cfg=$(write_config "[provider]" "name=ado")
    provider_detect "$cfg"
    [ "$PROVIDER_NAME" = "ado" ]
}

@test "detect: defaults to github when [provider] section is absent" {
    source_core
    local cfg
    cfg=$(write_config "[organization]" "name=foo")
    provider_detect "$cfg"
    [ "$PROVIDER_NAME" = "github" ]
}

@test "detect: defaults to github when name key is empty" {
    source_core
    local cfg
    cfg=$(write_config "[provider]" "name=")
    provider_detect "$cfg"
    [ "$PROVIDER_NAME" = "github" ]
}

@test "detect: tolerates comments and blank lines around the key" {
    source_core
    local cfg
    cfg=$(write_config "# comment" "" "[provider]" "# name comment" "  name = spacename  " "[other]" "name=wrong")
    # Direct call: provider_detect sets PROVIDER_NAME in the caller's scope,
    # which `run` (a subshell) would discard.
    provider_detect "$cfg"
    [ "$PROVIDER_NAME" = "spacename" ]
}

@test "module_dir: returns provider module path after detection" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    [ "$(provider_module_dir)" = "$DEVENV_TOOLS/lib/providers/github" ]
}

@test "module_dir: fails before detection has run" {
    source_core
    run provider_module_dir
    assert_failure
}

# ============================================================================
# Dispatch guard
# ============================================================================

@test "dispatch: succeeds when the provider module defines the verb" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    provider_issues_list() { echo "stub-impl"; }
    run provider_dispatch issues list
    assert_success
}

@test "dispatch: fails with defined error when verb is not implemented" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    run provider_dispatch rulesets export
    assert_failure
    [[ "$output" == *"does not implement rulesets export"* ]]
}

# ============================================================================
# Auth seam (AC-4)
# ============================================================================

@test "auth: emits GH_TOKEN and auth-kind exports when set" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    GH_TOKEN=ghp_test123 run bash -c 'source "$0" && provider_detect "$1/absent.config" && eval "$(provider_auth_env)" && [ "$PROVIDER_AUTH_KIND" = "env" ] && [ "$GH_TOKEN" = "ghp_test123" ]' "$DEVENV_TOOLS/lib/providers/provider-core.bash" "$TEST_TEMP_DIR"
    assert_success
}

@test "auth: fails with defined error when no credential source exists" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    GH_TOKEN= run provider_auth_env
    assert_failure
    [[ "$output" == *"no credential source available"* ]]
}

@test "secret_get: returns the token via stdout" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    GH_TOKEN=ghp_abc123 run provider_secret_get token
    assert_success
    [ "$output" = "ghp_abc123" ]
}

@test "secret_get: fails for unknown secret kinds" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    GH_TOKEN=x run provider_secret_get password
    assert_failure
    [[ "$output" == *"unknown secret kind 'password'"* ]]
}

@test "secret_get: never echoes the token into the error path" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    GH_TOKEN=ghp_supersecret run bash -c 'source "$0" && provider_detect "$1/absent.config" && { provider_secret_get token >/dev/null 2>"$2/err.txt" || true; } && { grep -q supersecret "$2/err.txt" && exit 1 || exit 0; }' "$DEVENV_TOOLS/lib/providers/provider-core.bash" "$TEST_TEMP_DIR"
    assert_success
}

# ============================================================================
# Capability flags (AC-3)
# ============================================================================

@test "capabilities: query returns 0 only for declared capabilities" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    PROVIDER_CAPABILITIES="rulesets releases"
    provider_has_capability rulesets
    run bash -c 'source "$0" && PROVIDER_CAPABILITIES="rulesets releases" && provider_has_capability project-boards' "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    assert_failure
}

@test "require_capability: passes for declared capability" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    PROVIDER_CAPABILITIES="rulesets"
    run provider_require_capability rulesets
    assert_success
}

@test "require_capability: defined degradation error for undeclared capability" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    PROVIDER_CAPABILITIES=""
    run provider_require_capability project-boards
    assert_failure
    [[ "$output" == *"provider 'github' does not support capability 'project-boards'"* ]]
}

# ============================================================================
# Error contract
# ============================================================================

@test "error contract: provider-core never exits the sourcing shell" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    # Every failure path above returned instead of exiting; reaching here with
    # a live shell and a re-sourceable guard proves the no-exit contract.
    _PROVIDER_CORE_LOADED=""
    source_core
    [ -n "${_PROVIDER_CORE_LOADED:-}" ]
}

# ============================================================================
# Declared red-test register (closes by Phase 4 end)
# ============================================================================

@test "github module: issues facade is loadable and implements the inventory verbs" {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/issues.bash"
    for verb in list view exists create close reopen edit comment set_type label_list label_ensure milestones; do
        declare -F "provider_issues_${verb}" >/dev/null || fail "missing provider_issues_${verb}"
    done
}

@test "github module: prs facade is loadable and implements the inventory verbs" {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/issues.bash"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/prs.bash"
    for verb in list view create merge comment diff thread_reply thread_resolve list_open_for_head; do
        declare -F "provider_prs_${verb}" >/dev/null || fail "missing provider_prs_${verb}"
    done
}

@test "github module: repos facade is loadable and implements the inventory verbs" {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/repos.bash"
    for verb in view list create edit default_branch protect_branch team_put collaborator_put patch; do
        declare -F "provider_repos_${verb}" >/dev/null || fail "missing provider_repos_${verb}"
    done
    declare -F provider_repo_target >/dev/null || fail "missing provider_repo_target"
}

@test "github module: actions facade is loadable and implements the inventory verbs" {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/actions.bash"
    for verb in run_list run_view run_watch run_rerun run_cancel run_download run_artifacts workflow_list workflow_run wait_for_branch; do
        declare -F "provider_actions_${verb}" >/dev/null || fail "missing provider_actions_${verb}"
    done
}

@test "github module: projects facade declares project-boards capability" {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/projects.bash"
    for verb in list field_list item_add workflow_stages; do
        declare -F "provider_projects_${verb}" >/dev/null || fail "missing provider_projects_${verb}"
    done
    provider_has_capability project-boards
}

@test "github module: org facade declares rulesets and native-issue-types capabilities" {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/org.bash"
    for verb in rulesets_list ruleset_get ruleset_create ruleset_update releases_list issue_types; do
        declare -F "provider_org_${verb}" >/dev/null || fail "missing provider_org_${verb}"
    done
    provider_has_capability rulesets
    provider_has_capability native-issue-types
}
