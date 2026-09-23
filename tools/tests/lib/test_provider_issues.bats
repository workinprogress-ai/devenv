#!/usr/bin/env bats
# Contract tests for the github issues domain facade.
# Covers: module load + registration, inventory verbs, arg pass-through via
# stub_gh call-log assertions, mutation assertions (incl. not-issued-on-
# validation-failure), and the native-issue-types capability contract.

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
}

# ============================================================================
# Load & capability registration
# ============================================================================

@test "issues module: loads and registers native-issue-types capability" {
    provider_has_capability native-issue-types
}

@test "issues module: is idempotent under re-source" {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/issues.bash"
    declare -F provider_issues_list >/dev/null
}

# ============================================================================
# Reads
# ============================================================================

@test "issues list: passes -R repo and flags through to gh" {
    run provider_issues_list org/repo --state open --limit 5
    assert_success
    grep -q "^gh issue list -R org/repo --state open --limit 5$" "$STUB_CALL_LOG"
}

@test "issues list: without repo omits -R (cwd/GH_REPO resolution)" {
    run provider_issues_list --state all
    assert_success
    grep -q "^gh issue list --state all$" "$STUB_CALL_LOG"
}

@test "issues view: passes number and repo" {
    run provider_issues_view org/repo 42
    assert_success
    grep -q "^gh issue view 42 -R org/repo$" "$STUB_CALL_LOG"
}

@test "issues exists: succeeds when gh view succeeds" {
    run provider_issues_exists org/repo 7
    assert_success
    grep -q "^gh issue view 7 -R org/repo --json number$" "$STUB_CALL_LOG"
}

# ============================================================================
# Mutations — issued assertions
# ============================================================================

@test "issues create: passes title/body/repo to gh" {
    run provider_issues_create org/repo --title "T" --body "B"
    assert_success
    grep -q "^gh issue create -R org/repo --title T --body B$" "$STUB_CALL_LOG"
}

@test "issues close: passes number and repo" {
    run provider_issues_close org/repo 9
    assert_success
    grep -q "^gh issue close 9 -R org/repo$" "$STUB_CALL_LOG"
}

@test "issues reopen: passes number and repo" {
    run provider_issues_reopen org/repo 9
    assert_success
    grep -q "^gh issue reopen 9 -R org/repo$" "$STUB_CALL_LOG"
}

@test "issues edit: passes number, repo, and fields" {
    run provider_issues_edit org/repo 12 --title "New"
    assert_success
    grep -q "^gh issue edit 12 -R org/repo --title New$" "$STUB_CALL_LOG"
}

@test "issues comment: passes number and body" {
    run provider_issues_comment org/repo 12 --comment-body "hello"
    assert_success
    grep -q "^gh issue comment 12 -R org/repo --comment-body hello$" "$STUB_CALL_LOG"
}

# ============================================================================
# Mutations — not-issued assertions
# ============================================================================

@test "issues create: when gh fails, mutation is recorded but function fails" {
    STUB_GH_FAIL=1 run provider_issues_create org/repo --title "T"
    assert_failure
    # gh stub still logs the attempt (the facade passed it through correctly)
    grep -q "^gh issue create -R org/repo --title T$" "$STUB_CALL_LOG"
}

@test "issues set_type: native type edit not issued when capability is absent" {
    PROVIDER_CAPABILITIES=""
    run provider_issues_set_type org repo 5 Bug
    assert_failure
    [[ "$(stub_call_count gh)" -eq 0 ]]
}

@test "issues set_type: rejects invalid type names before any gh call" {
    normalize_issue_type() { return 1; }  # policy layer rejects
    run provider_issues_set_type org repo 5 NotAType
    assert_failure
    [[ "$(stub_call_count gh)" -eq 0 ]]
}

@test "issues set_type: issues GH_REPO-prefixed edit for valid type" {
    normalize_issue_type() { echo "Bug"; }  # policy layer maps
    GH_TOKEN=x run provider_issues_set_type org repo 5 bug
    grep -q "gh issue edit 5 --type Bug" "$STUB_CALL_LOG"
}

# ============================================================================
# Labels
# ============================================================================

@test "label list: passes repo and caller flags through unchanged" {
    run provider_issues_label_list org/repo --json name
    assert_success
    grep -q "^gh label list -R org/repo --json name$" "$STUB_CALL_LOG"
}

@test "label ensure: creates when label absent, skips when present" {
    # absent: empty label list -> create issued
    printf '[]' > "$TEST_TEMP_DIR/labels.json"
    export STUB_GH_API_RESPONSE="$TEST_TEMP_DIR/labels.json"
    run provider_issues_label_ensure org/repo priority-high
    assert_success
    grep -q "gh label create priority-high -R org/repo" "$STUB_CALL_LOG"
}

@test "milestones: trailing flags pass through to gh api (issue-triage --jq)" {
    gh_calls_reset
    provider_issues_milestones "org/repo" --jq '.[] | .title'
    gh_last_call_equals "api repos/org/repo/milestones --jq .[] | .title"
}

@test "label list: no duplicate --json when caller supplies fields" {
    gh_calls_reset
    provider_issues_label_list "org/repo" --limit 200 --json name,description,color
    gh_last_call_equals "label list -R org/repo --limit 200 --json name,description,color"
}

@test "gh_repo_args: repo value with command substitution stays inert" {
    # Regression lock: the helper once eval'd its input, executing $(...)
    # from repo names (audit F009). printf -v assignment is inert by design.
    local arr=()
    local probe_file="$TEST_TEMP_DIR/pwned-marker"
    rm -f "$probe_file"
    provider_gh_repo_args arr "a\$(touch '$probe_file')b"
    [ "${arr[0]}" = "-R" ]
    [ "${arr[1]}" = "a\$(touch '$probe_file')b" ]
    [ ! -f "$probe_file" ]
}

@test "issues list: valueless flag passes through without swallowing the next arg" {
    gh_calls_reset
    provider_issues_list "" --web
    gh_last_call_equals "issue list --web"
}

@test "issues list: valued flag followed by boolean parses both" {
    gh_calls_reset
    provider_issues_list "" --state open --web
    gh_last_call_equals "issue list --state open --web"
}

@test "issues list: flag missing its value fails defined" {
    run provider_issues_list "" --state
    [ "$status" -ne 0 ]
    [[ "$output" == *"requires a value"* ]]
}

@test "label ensure: list failure is reported, not treated as absent" {
    # A gh stub that fails the list forces the defined error path.
    local fail_bin="$TEST_TEMP_DIR/failbin"
    mkdir -p "$fail_bin"
    printf '#!/usr/bin/env bash\n[ "$1" = "label" ] && [ "$2" = "list" ] && exit 1\nexit 0\n' > "$fail_bin/gh"
    chmod +x "$fail_bin/gh"
    PATH="$fail_bin:$PATH" run provider_issues_label_ensure "org/repo" "some-label"
    [ "$status" -ne 0 ]
    [[ "$output" == *"cannot list labels"* ]]
}
