#!/usr/bin/env bats
# Contract tests for foreign-remote safety (issue #34):
# - repo_is_org_member membership check (member / foreign / ambiguous / URL forms)
# - configure_git_repo refuses to rewrite a foreign repo's remote, warns,
#   and still applies the rest of the local git configuration
# - org repos are configured exactly as before (control)

bats_require_minimum_version 1.5.0

load ../test_helper

assert_success() {
    [ "$status" -eq 0 ]
}

assert_failure() {
    [ "$status" -ne 0 ]
}

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    export DEVENV_ROOT="${PROJECT_ROOT}"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/error-handling.bash"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/git-operations.bash"
}

# Init a git repo with an origin owned by the given owner
make_repo_with_origin() {
    local dir="$1" owner="$2" repo="$3"
    git init -q "$dir"
    git -C "$dir" config user.email t@t
    git -C "$dir" config user.name t
    git -C "$dir" remote add origin "https://github.com/$owner/$repo.git"
}

# ============================================================================
# repo_is_org_member
# ============================================================================

# Org resolution is config/seed-scoped: point DEVENV_ROOT at a mock identity
# root for the duration of a membership call.
membership_org() {
    local org="$1" root="$2"
    printf '[organization]\nname=t\norg=%s\n' "$org" > "$root/devenv.config"
    DEVENV_ROOT="$root" DEVENV_ROOT_SET=1 run repo_is_org_member "${@:3}"
}

@test "membership: org repo spec is a member" {
    membership_org myorg "$TEST_TEMP_DIR" "myorg/myrepo"
    assert_success
}

@test "membership: foreign owner is not a member" {
    membership_org myorg "$TEST_TEMP_DIR" "otherorg/repo"
    assert_failure
}

@test "membership: https URL with credentials, member" {
    membership_org myorg "$TEST_TEMP_DIR" "https://user:ghp_x@github.com/myorg/repo.git"
    assert_success
}

@test "membership: https URL without credentials, foreign" {
    membership_org myorg "$TEST_TEMP_DIR" "https://github.com/other/repo"
    assert_failure
}

@test "membership: current-origin form (credential-bearing foreign) is foreign" {
    # the real-world shape found in repos/: user:token@ foreign remote
    membership_org myorg "$TEST_TEMP_DIR" "https://user:ghp_x@github.com/foreign/fork.git"
    assert_failure
}

@test "membership: SSH form (git@host:owner/repo) recognized" {
    membership_org test-org "$TEST_TEMP_DIR" "git@github.com:test-org/dummy.git"
    assert_success
    membership_org test-org "$TEST_TEMP_DIR" "git@github.com:otherorg/dummy.git"
    assert_failure
}

@test "membership: ambiguous — no org configured anywhere" {
    unset GH_ORG
    # point DEVENV_ROOT at a dir without devenv.config
    local empty_cfg="$TEST_TEMP_DIR/no-config"
    mkdir -p "$empty_cfg"
    DEVENV_ROOT="$empty_cfg" run repo_is_org_member "myorg/repo"
    assert_failure
    [[ "$output" == *"no GitHub org configured"* ]]
}

@test "membership: ambiguous — unparseable spec treated as foreign with warning" {
    GH_ORG=myorg run repo_is_org_member "not-a-url-or-spec"
    assert_failure
    [[ "$output" == *"cannot parse owner"* ]]
}

@test "membership: falls back to devenv.config [organization] org" {
    local cfg_root="$TEST_TEMP_DIR/cfgroot"
    mkdir -p "$cfg_root"
    printf '[organization]\nname=X\norg=cforg\n' > "$cfg_root/devenv.config"
    DEVENV_ROOT="$cfg_root" run repo_is_org_member "cforg/repo"
    assert_success
    DEVENV_ROOT="$cfg_root" run repo_is_org_member "other/repo"
    assert_failure
}

# ============================================================================
# configure_git_repo guard
# ============================================================================

@test "guard: foreign repo remote is NOT rewritten, warning emitted, local config still applied" {
    local dir="$TEST_TEMP_DIR/foreign"
    make_repo_with_origin "$dir" foreignorg some-repo
    (
        cd "$dir" || exit 1
        GH_ORG=myorg configure_git_repo "." "https://user:ghp_x@github.com/myorg/some-repo.git"
    ) > "$TEST_TEMP_DIR/out.txt" 2>&1
    # remote untouched
    [ "$(git -C "$dir" remote get-url origin)" = "https://github.com/foreignorg/some-repo.git" ]
    # warning emitted
    grep -q "skipping remote URL rewrite" "$TEST_TEMP_DIR/out.txt"
    # local settings still applied (the non-rewrite parts of the function ran)
    [ "$(git -C "$dir" config core.autocrlf)" = "false" ]
}

@test "guard: org repo remote IS rewritten as before (control)" {
    local dir="$TEST_TEMP_DIR/orgrepo"
    make_repo_with_origin "$dir" myorg some-repo
    printf '[organization]\nname=t\norg=myorg\n' > "$TEST_TEMP_DIR/devenv.config"
    (
        cd "$dir" || exit 1
        DEVENV_ROOT="$TEST_TEMP_DIR" DEVENV_ROOT_SET=1 configure_git_repo "." "https://user:ghp_x@github.com/myorg/some-repo.git"
    ) > "$TEST_TEMP_DIR/out.txt" 2>&1
    [ "$(git -C "$dir" remote get-url origin)" = "https://user:ghp_x@github.com/myorg/some-repo.git" ]
}
