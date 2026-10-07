#!/usr/bin/env bats
# Tests for scripts/repo-get.sh input validation and sourcing

bats_require_minimum_version 1.5.0

load ../test_helper

# Simple assert helpers
assert_success() {
    [ "$status" -eq 0 ]
}

assert_failure() {
    [ "$status" -ne 0 ]
}

assert_output_contains() {
    local expected="$1"
    if [[ ! "$output" =~ $expected ]]; then
        echo "Expected output to contain: $expected"
        echo "Actual output: $output"
        return 1
    fi
}

@test "repo-get: has valid bash syntax" {
    run bash -n "$PROJECT_ROOT/tools/scripts/repo-get.sh"
    assert_success
}

@test "repo-get: sources git-operations library" {
    run bash -c "grep -q 'source.*lib/git-operations.bash' $PROJECT_ROOT/tools/scripts/repo-get.sh"
    assert_success
}

@test "repo-get: sources error-handling library if present" {
    run bash -c "grep -q 'source.*lib/error-handling.bash' $PROJECT_ROOT/tools/scripts/repo-get.sh"
    assert_success
}

@test "repo-get: fails when repository name is missing and no git context" {
    cd "$TEST_TEMP_DIR"  # Run from non-git directory
    run "$PROJECT_ROOT/tools/scripts/repo-get.sh" 2>/dev/null
    assert_failure
    assert_output_contains "Usage:"
}

@test "repo-get: rejects invalid characters in repo name" {
    run "$PROJECT_ROOT/tools/scripts/repo-get.sh" "repo@name" 2>&1
    assert_failure
    assert_output_contains "Invalid repository name"

    run "$PROJECT_ROOT/tools/scripts/repo-get.sh" "repo name" 2>&1
    assert_failure
}

@test "repo-get: rejects reserved names" {
    run "$PROJECT_ROOT/tools/scripts/repo-get.sh" "repos" 2>&1
    assert_failure
    assert_output_contains "Invalid repository name"

    run "$PROJECT_ROOT/tools/scripts/repo-get.sh" "." 2>&1
    assert_failure
}

@test "repo-get: requires alphanumeric start" {
    run "$PROJECT_ROOT/tools/scripts/repo-get.sh" "-repo" 2>&1
    assert_failure
    assert_output_contains "Invalid repository name"
}

@test "repo-get: --all flag is present in usage help" {
    run bash -c "grep -q '\-\-all' $PROJECT_ROOT/tools/scripts/repo-get.sh"
    assert_success
}

@test "repo-get: usage mentions --all option" {
    run bash -c "grep 'Usage' $PROJECT_ROOT/tools/scripts/repo-get.sh"
    assert_success
    assert_output_contains "\-\-all"
}

@test "repo-get: defines get_available_repos function" {
    run bash -c "grep -q '^get_available_repos()' $PROJECT_ROOT/tools/scripts/repo-get.sh"
    assert_success
}

@test "repo-get: --all mode sets ALL_MODE=true" {
    run bash -c "grep -q 'ALL_MODE=true' $PROJECT_ROOT/tools/scripts/repo-get.sh"
    assert_success
}

# ============================================================================
# Real runs of repo-get.sh against a stubbed provider CLI and stubbed git
# ============================================================================

# Stubs: `gh auth status` succeeds and `gh repo list` prints $STUB_ORG_REPOS;
# git records every call, and `git clone <url> <dir>` creates <dir> (failing
# for the repo named in $STUB_CLONE_FAIL). The org is the sandboxed config's.
setup_repo_get_world() {
    mkdir -p "$TEST_TEMP_DIR/bin" "$DEVENV_ROOT/repos"
    export STUB_LOG="$TEST_TEMP_DIR/calls.log"
    : > "$STUB_LOG"
    cat > "$TEST_TEMP_DIR/bin/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$STUB_LOG"
case "$1" in
  # real gh answers --json with a JSON array: one {name} per line of $STUB_ORG_REPOS
  repo) printf '%b' "${STUB_ORG_REPOS:-}" | jq -R -s -c 'split("\n") | map(select(length > 0)) | map({name: .})' ;;
esac
exit 0
STUB
    cat > "$TEST_TEMP_DIR/bin/git" <<'STUB'
#!/usr/bin/env bash
echo "git $*" >> "$STUB_LOG"
if [ "$1" = clone ]; then
    case "$2" in *"/${STUB_CLONE_FAIL:-@none@}.git"|*"/${STUB_CLONE_FAIL:-@none@}") exit 1 ;; esac
    mkdir -p "$3"
fi
exit 0
STUB
    chmod +x "$TEST_TEMP_DIR/bin/gh" "$TEST_TEMP_DIR/bin/git"
}

run_repo_get() {
    PATH="$TEST_TEMP_DIR/bin:$PATH" bash "$PROJECT_ROOT/tools/scripts/repo-get.sh" "$@"
}

@test "repo-get --all exits 0 without cloning when every org repo is already local" {
    setup_repo_get_world
    mkdir -p "$DEVENV_ROOT/repos/repo-alpha" "$DEVENV_ROOT/repos/repo-beta"
    export STUB_ORG_REPOS='repo-alpha\nrepo-beta\n'
    run run_repo_get --all
    [ "$status" -eq 0 ]
    [[ "$output" == *"already cloned"* ]]
    run ! grep -q '^git clone' "$STUB_LOG"
}

@test "repo-get --all clones exactly the org repos that are not yet local" {
    setup_repo_get_world
    mkdir -p "$DEVENV_ROOT/repos/repo-beta"
    export STUB_ORG_REPOS='repo-alpha\nrepo-beta\nrepo-gamma\n'
    run run_repo_get --all
    [ "$status" -eq 0 ]
    [ -d "$DEVENV_ROOT/repos/repo-alpha" ]
    [ -d "$DEVENV_ROOT/repos/repo-gamma" ]
    [ "$(grep -c '^git clone' "$STUB_LOG")" -eq 2 ]
    grep '^git clone' "$STUB_LOG" | grep -q 'test-org/repo-alpha'
    grep '^git clone' "$STUB_LOG" | grep -q 'test-org/repo-gamma'
    [ "$(grep '^git clone' "$STUB_LOG" | grep -c 'repo-beta')" -eq 0 ]
}

@test "repo-get --all reports a failed clone, exits 1, and still clones the rest" {
    setup_repo_get_world
    export STUB_ORG_REPOS='repo-alpha\nrepo-gamma\n'
    export STUB_CLONE_FAIL=repo-alpha
    run run_repo_get --all
    [ "$status" -eq 1 ]
    [[ "$output" == *"Failed to clone repo-alpha"* ]]
    [ -d "$DEVENV_ROOT/repos/repo-gamma" ]
}

@test "repo-get --all: a failed clone does not go on to configure or fetch anything" {
    setup_repo_get_world
    export STUB_ORG_REPOS='repo-alpha\n'
    export STUB_CLONE_FAIL=repo-alpha
    run run_repo_get --all
    [ "$status" -eq 1 ]
    run ! grep -qE '^git (config|fetch|remote)' "$STUB_LOG"
}

@test "repo-get strips a trailing slash before validating and updating an existing repo" {
    setup_repo_get_world
    mkdir -p "$DEVENV_ROOT/repos/my-repo"
    run run_repo_get "my-repo/"
    [ "$status" -eq 0 ]
    [[ "$output" != *"Invalid repository name"* ]]
    grep -q '^git fetch' "$STUB_LOG"
}
