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
    unset DEVENV_REPO GH_REPO
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

@test "repo_target: GITHUB_REPO env has no effect when argument present" {
    local out
    out=$(GITHUB_REPO=env/repo provider_repo_target explicit/repo)
    [ "$out" = "explicit/repo" ]
}

@test "repo_target: GITHUB_REPO env has no effect (no devenv alias)" {
    # Isolate the seed path: a real DEVENV_ROOT seed would satisfy the cwd
    # leg and hide the assertion this test exists for.
    local isolated_root="$TEST_TEMP_DIR/no-seed-root"
    mkdir -p "$isolated_root"
    run env -u DEVENV_REPO DEVENV_ROOT="$isolated_root" GITHUB_REPO=env/repo bash -c 'source "$0" && provider_repo_target' "$DEVENV_TOOLS/lib/providers/github/repos.bash"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "repo_target: GH_REPO full form used as fallback" {
    GH_REPO=gh/repo run provider_repo_target
    [ "$output" = "gh/repo" ]
}

@test "repo_target: basename-only GH_REPO falls through to cwd leg" {
    # Basename GH_REPO is invalid for -R, so it must not be echoed as-is;
    # the full chain resolves it via the cwd leg instead.
    local repo_dir="$TEST_TEMP_DIR/t-repo"
    mkdir -p "$repo_dir" && (cd "$repo_dir" && git init -q && git config user.email t@t && git config user.name t)
    local script="$TEST_TEMP_DIR/target_partial2.sh"
    cat > "$script" <<SEOF
export DEVENV_TOOLS="$DEVENV_TOOLS"
unset _PROVIDER_CORE_LOADED PROVIDER_NAME DEVENV_REPO
source "\$DEVENV_TOOLS/lib/providers/provider-core.bash"
provider_detect "$TEST_TEMP_DIR/absent.config"
source "\$DEVENV_TOOLS/lib/providers/github/repos.bash"
provider_org_get() { echo cfg-org; }
GH_REPO=justname
export GH_REPO
cd "$repo_dir"
provider_repo_target
SEOF
    run bash "$script"
    [ "$status" -eq 0 ]
    [ "$output" = "cfg-org/t-repo" ]
}

@test "repo_target: empty result when env empty, org unresolvable, no git root" {
    local script="$TEST_TEMP_DIR/target_empty.sh"
    mkdir -p "$TEST_TEMP_DIR/nogit"
    cat > "$script" <<SEOF
export DEVENV_TOOLS="$DEVENV_TOOLS"
unset _PROVIDER_CORE_LOADED PROVIDER_NAME DEVENV_REPO GH_REPO GH_ORG
source "\$DEVENV_TOOLS/lib/providers/provider-core.bash"
provider_detect "$TEST_TEMP_DIR/absent.config"
source "\$DEVENV_TOOLS/lib/providers/github/repos.bash"
provider_org_get() { return 1; }
cd "$TEST_TEMP_DIR/nogit"
provider_repo_target
SEOF
    run bash "$script"
    [ "$status" -eq 0 ]
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

# ============================================================================
# Full-chain repo target: explicit arg → DEVENV_REPO → GH_REPO full form →
# org identity + cwd basename → empty. Mirrors the documented wrapper
# resolution chain; semantics must not change when provider-loader delegates
# here.
# ============================================================================

@test "repo_target: org + cwd basename when env chain empty" {
    local repo_dir="$TEST_TEMP_DIR/cwd-repo"
    mkdir -p "$repo_dir" && (cd "$repo_dir" && git init -q && git config user.email t@t && git config user.name t)
    local script="$TEST_TEMP_DIR/target_full_chain.sh"
    cat > "$script" <<SEOF
export DEVENV_TOOLS="$DEVENV_TOOLS"
unset _PROVIDER_CORE_LOADED PROVIDER_NAME DEVENV_REPO GH_REPO GH_ORG
source "\$DEVENV_TOOLS/lib/providers/provider-core.bash"
provider_detect "$TEST_TEMP_DIR/absent.config"
source "\$DEVENV_TOOLS/lib/providers/github/repos.bash"
provider_org_get() { echo cfg-org; }
cd "$repo_dir"
provider_repo_target
SEOF
    run bash "$script"
    [ "$status" -eq 0 ]
    [ "$output" = "cfg-org/cwd-repo" ]
}


@test "repo_target: partial-form GH_REPO does not shadow cwd resolution" {
    local repo_dir="$TEST_TEMP_DIR/cwd-repo2"
    mkdir -p "$repo_dir" && (cd "$repo_dir" && git init -q && git config user.email t@t && git config user.name t)
    local script="$TEST_TEMP_DIR/target_partial.sh"
    cat > "$script" <<SEOF
export DEVENV_TOOLS="$DEVENV_TOOLS"
unset _PROVIDER_CORE_LOADED PROVIDER_NAME DEVENV_REPO
source "\$DEVENV_TOOLS/lib/providers/provider-core.bash"
provider_detect "$TEST_TEMP_DIR/absent.config"
source "\$DEVENV_TOOLS/lib/providers/github/repos.bash"
provider_org_get() { echo cfg-org; }
GH_REPO=justname
export GH_REPO
cd "$repo_dir"
provider_repo_target
SEOF
    run bash "$script"
    [ "$status" -eq 0 ]
    [ "$output" = "cfg-org/cwd-repo2" ]
}

# ============================================================================
# URL/host seam (urls.bash): the single sanctioned home for the github.com
# literal in URL work.
# ============================================================================

@test "urls: transport URL is clean https org form" {
    source "$DEVENV_TOOLS/lib/providers/github/urls.bash"
    run provider_git_transport_url org repo
    [ "$status" -eq 0 ]
    [ "$output" = "https://github.com/org/repo.git" ]
    run provider_git_transport_url org ""
    [ "$status" -ne 0 ]
}

@test "urls: web URL builds repo-relative links" {
    source "$DEVENV_TOOLS/lib/providers/github/urls.bash"
    run provider_web_url org/repo pull/12
    [ "$status" -eq 0 ]
    [ "$output" = "https://github.com/org/repo/pull/12" ]
}

@test "urls: extract_url pulls first URL, path filter narrows" {
    source "$DEVENV_TOOLS/lib/providers/github/urls.bash"
    local out
    out=$(printf 'junk\nhttps://github.com/o/r/pull/9 tail\nhttps://github.com/o/r/issues/3\n' | provider_extract_url)
    [ "$out" = "https://github.com/o/r/pull/9" ]
    out=$(printf 'x https://github.com/o/r/pull/9\ny https://github.com/o/r/issues/3\n' | provider_extract_url issues/)
    [ "$out" = "https://github.com/o/r/issues/3" ]
    run bash -c "printf 'no urls here\n' | '$DEVENV_TOOLS/lib/providers/github/urls.bash' 2>/dev/null"
    :
}

@test "urls: extract_url returns nonzero when nothing matches" {
    source "$DEVENV_TOOLS/lib/providers/github/urls.bash"
    run bash -c "printf 'nothing\n' | { source '$DEVENV_TOOLS/lib/providers/github/urls.bash'; provider_extract_url; }"
    [ "$status" -ne 0 ]
}

@test "urls: remote_to_web normalizes ssh and https forms, rejects foreign hosts" {
    source "$DEVENV_TOOLS/lib/providers/github/urls.bash"
    run provider_remote_to_web "git@github.com:org/repo.git"
    [ "$output" = "https://github.com/org/repo" ]
    run provider_remote_to_web "https://github.com/org/repo.git"
    [ "$output" = "https://github.com/org/repo" ]
    run provider_remote_to_web "https://gitlab.com/org/repo.git"
    [ "$status" -ne 0 ]
}

@test "org releases: empty repo is a defined failure (required owner/repo)" {
    # The org module ships the releases verb; load it standalone here.
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/org.bash"
    gh_calls_reset
    run provider_org_releases_list ""
    [ "$status" -ne 0 ]
    [[ "$output" == *"owner/repo"* ]]
}

@test "org releases: non owner/repo form is rejected" {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/org.bash"
    run provider_org_releases_list "just-a-name"
    [ "$status" -ne 0 ]
}

@test "repo target: DEVENV_REPO is the single env override" {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/repos.bash"
    run env DEVENV_REPO="new/repo" GITHUB_REPO="legacy/repo" bash -c 'source "$0" && provider_repo_target' "$DEVENV_TOOLS/lib/providers/github/repos.bash"
    [ "$output" = "new/repo" ]
}

@test "repo target: GITHUB_REPO has no effect (no devenv alias exists)" {
    # GITHUB_REPO must not resolve; the seed path is isolated too (a real
    # DEVENV_ROOT seed would otherwise satisfy the cwd leg and mask the
    # assertion).
    # shellcheck disable=SC1091
    local isolated_root="$TEST_TEMP_DIR/no-seed-root"
    mkdir -p "$isolated_root"
    run env -u DEVENV_REPO DEVENV_ROOT="$isolated_root" GITHUB_REPO="legacy/repo" bash -c 'source "$0" && provider_repo_target' "$DEVENV_TOOLS/lib/providers/github/repos.bash"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}
