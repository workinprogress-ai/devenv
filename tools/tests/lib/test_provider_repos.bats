#!/usr/bin/env bats
# Contract tests for the github repos domain facade.
# Includes the targeting-normalization helper (provider_repo_target) coverage.

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
    unset GITHUB_REPO GH_REPO
    stub_gh
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    provider_detect "$TEST_TEMP_DIR/absent.config"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/issues.bash"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/repos.bash"
}

# ============================================================================
# Targeting normalization (provider_repo_target)
# ============================================================================

@test "repo_target: explicit argument wins" {
    local out
    out=$(GITHUB_REPO=env/repo provider_repo_target explicit/repo)
    [ "$out" = "explicit/repo" ]
}

@test "repo_target: GITHUB_REPO env used when no argument" {
    GITHUB_REPO=env/repo run provider_repo_target
    [ "$output" = "env/repo" ]
}

@test "repo_target: GH_REPO full form used as fallback" {
    GH_REPO=gh/repo run provider_repo_target
    [ "$output" = "gh/repo" ]
}

@test "repo_target: basename-only GH_REPO is rejected (empty; gh -R invalid)" {
    GH_REPO=justname run provider_repo_target
    [ -z "$output" ]
}

@test "repo_target: empty result when nothing is set (cwd resolution)" {
    run provider_repo_target
    [ -z "$output" ]
}

@test "repo_split: splits owner/repo; rejects bare names" {
    local o n
    provider_repo_split org/name o n
    [ "$o" = "org" ] && [ "$n" = "name" ]
    run provider_repo_split bare o n
    assert_failure
    [[ "$output" == *"not owner/repo form"* ]]
}

# ============================================================================
# Reads
# ============================================================================

@test "repos view: -R flag when repo given" {
    run provider_repos_view org/repo --json name
    assert_success
    grep -q "^gh repo view -R org/repo --json name$" "$STUB_CALL_LOG"
}

@test "repos view: no -R when repo omitted (cwd resolution)" {
    run provider_repos_view --json name
    assert_success
    grep -q "^gh repo view --json name$" "$STUB_CALL_LOG"
}

@test "repos list: positional org with limit" {
    run provider_repos_list myorg --limit 10 --json name
    assert_success
    grep -q "^gh repo list myorg --limit 10 --json name$" "$STUB_CALL_LOG"
}

@test "repos default branch: queries the REST endpoint" {
    run provider_repos_default_branch org/repo
    assert_success
    grep -q '^gh api repos/org/repo --jq .default_branch$' "$STUB_CALL_LOG"
}

# ============================================================================
# Mutations
# ============================================================================

@test "repos create: name and flags pass through" {
    run provider_repos_create newrepo --private
    assert_success
    grep -q "^gh repo create newrepo --private$" "$STUB_CALL_LOG"
}

@test "repos edit: template flip passes through" {
    run provider_repos_edit org/repo --template
    assert_success
    grep -q "^gh repo edit org/repo --template$" "$STUB_CALL_LOG"
}

@test "repos protect branch: PUT to the protection endpoint with payload" {
    printf '{"required_status_checks":null}' > "$TEST_TEMP_DIR/payload.json"
    run provider_repos_protect_branch org/repo main "$TEST_TEMP_DIR/payload.json"
    assert_success
    grep -q "^gh api -X PUT --input $TEST_TEMP_DIR/payload.json repos/org/repo/branches/main/protection$" "$STUB_CALL_LOG"
}

@test "repos team put: PUT to the org teams endpoint" {
    run provider_repos_team_put myorg myteam org/repo
    assert_success
    grep -q "^gh api -X PUT orgs/myorg/teams/myteam/repos/org/repo$" "$STUB_CALL_LOG"
}

@test "repos collaborator put: PUT to the collaborators endpoint" {
    run provider_repos_collaborator_put org/repo someuser
    assert_success
    grep -q "^gh api -X PUT repos/org/repo/collaborators/someuser$" "$STUB_CALL_LOG"
}

@test "repos patch: PATCH with field args" {
    export STUB_GH_MUTATIONS="$TEST_TEMP_DIR/mutations.log"
    run provider_repos_patch org/repo -f description=x
    assert_success
    grep -q "PATCH" "$STUB_GH_MUTATIONS"
}

@test "repos protect branch: not issued when repo spec is bare (invalid)" {
    # bare name would put the PUT on an unresolvable endpoint; the facade
    # validates the spec before calling gh
    run provider_repos_protect_branch bare main /dev/null
    assert_failure
    [[ "$(stub_call_count gh)" -eq 0 ]]
}
