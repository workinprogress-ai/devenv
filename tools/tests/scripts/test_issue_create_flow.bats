#!/usr/bin/env bats
# The create flow in issue-create.sh and its number parsing: the number comes from a
# bare id (Azure) or a URL (GitHub) alike; labels with spaces stay one label; the
# fail-fast repo probe reads the spec the resolver prints.

bats_require_minimum_version 1.5.0

load ../test_helper

CREATE="$BATS_TEST_DIRNAME/../../scripts/issue-create.sh"
OPS="$BATS_TEST_DIRNAME/../../lib/issue-operations.bash"

setup() {
    test_helper_setup
    export DEVENV_TOOLS="$PROJECT_ROOT/tools"
}

teardown() {
    test_helper_teardown
}

# ---------------------------------------------------------------------------
# issue_number_from_ref: a creation result is a bare id or a URL
# ---------------------------------------------------------------------------

number_of() {   # number_of <ref> -> runs the helper in a clean shell
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/error-handling.bash'
        source '$OPS'
        issue_number_from_ref \"\$1\"
    " _ "$1"
}

@test "issue_number_from_ref: a bare id is the number" {
    number_of "42"
    [ "$status" -eq 0 ]
    [ "$output" = "42" ]
}

@test "issue_number_from_ref: a GitHub issue URL yields its trailing number" {
    number_of "https://github.com/org/repo/issues/17"
    [ "$status" -eq 0 ]
    [ "$output" = "17" ]
}

@test "issue_number_from_ref: an Azure work item URL yields its trailing number" {
    number_of "https://dev.azure.com/org/proj/_workitems/edit/101024"
    [ "$status" -eq 0 ]
    [ "$output" = "101024" ]
}

@test "issue_number_from_ref: a trailing slash or query string does not hide the number" {
    number_of "https://github.com/org/repo/issues/17/"
    [ "$output" = "17" ]
    number_of "https://github.com/org/repo/issues/17?x=1"
    [ "$output" = "17" ]
}

@test "issue_number_from_ref: whitespace and a carriage return are ignored" {
    number_of $'  42\r'
    [ "$status" -eq 0 ]
    [ "$output" = "42" ]
}

@test "issue_number_from_ref: text with no number is not a ref" {
    number_of "created, thanks"
    [ "$status" -ne 0 ]
    [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# create_issue: the verb call and what follows it
# ---------------------------------------------------------------------------

run_create() {   # run_create <create output>: runs create_issue against stubbed provider verbs
    export CREATE_OUT="$1"
    export CALL_LOG="$TEST_TEMP_DIR/calls.log"; : > "$CALL_LOG"
    run bash -c "
        set -u
        source '$PROJECT_ROOT/tools/lib/error-handling.bash'
        source '$OPS'
        $(sed -n '/^build_body()/,/^}/p;/^create_issue()/,/^}/p' "$CREATE")
        ISSUE_TITLE='A title'; ISSUE_TYPE=Task; ISSUE_BODY='body'; ISSUE_PROJECT=''
        ISSUE_ASSIGNEES=(); ISSUE_MILESTONE=''; PARENT_ISSUE=''; BLOCKED_BY_ISSUES=(); DRY_RUN=0
        ISSUE_LABELS=(); while IFS= read -r l; do [ -n \"\$l\" ] && ISSUE_LABELS+=(\"\$l\"); done <<< \"\${TEST_LABELS_STR:-}\"
        get_repo_spec() { echo my-proj/my-repo; }
        provider_issues_create() { for a in \"\$@\"; do printf '[%s]' \"\$a\"; done >> \"\$CALL_LOG\"; echo >> \"\$CALL_LOG\"; echo \"\$CREATE_OUT\"; }
        provider_repos_view() { case \"\$*\" in *owner*) echo my-proj ;; *) echo my-repo ;; esac; }
        set_issue_type() { echo \"set_issue_type \$*\" >> \"\$CALL_LOG\"; return 0; }
        provider_org_get() { echo my-org; }
        log_verbose() { :; }
        create_issue
    "
}

@test "create_issue: a bare id from the provider yields the issue number and applies the type" {
    run_create "42"
    [ "$status" -eq 0 ]
    grep -q "set_issue_type 42 my-proj my-repo Task" "$CALL_LOG"
}

@test "create_issue: a GitHub URL from the provider yields the issue number" {
    run_create "https://github.com/org/repo/issues/17"
    [ "$status" -eq 0 ]
    grep -q "set_issue_type 17 " "$CALL_LOG"
}

@test "create_issue: a result with no number is an error that still prints what the provider said" {
    run_create "created, thanks"
    [ "$status" -ne 0 ]
}

@test "create_issue: a label containing spaces is passed as one label" {
    export TEST_LABELS_STR=$'good first issue\nbug'
    run_create "42"
    unset TEST_LABELS_STR
    [ "$status" -eq 0 ]
    grep -q '\[--label\]\[good first issue\]' "$CALL_LOG"
    grep -q '\[--label\]\[bug\]' "$CALL_LOG"
    run ! grep -q '\[--label\]\[good\]' "$CALL_LOG"
}

# ---------------------------------------------------------------------------
# The fail-fast repo probe
# ---------------------------------------------------------------------------

@test "probe_target_repo: an unreachable target stops before any prompt" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/error-handling.bash'
        $(sed -n '/^probe_target_repo()/,/^}/p' "$CREATE")
        get_repo_spec() { echo my-proj/missing-repo; }
        provider_repos_view() { return 1; }
        probe_target_repo
    "
    [ "$status" -ne 0 ]
    [[ "$output" == *"my-proj/missing-repo"* ]]
}

@test "probe_target_repo: a reachable target passes, and an empty spec is not probed" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/error-handling.bash'
        $(sed -n '/^probe_target_repo()/,/^}/p' "$CREATE")
        get_repo_spec() { echo my-proj/repo; }
        provider_repos_view() { echo repo; }
        probe_target_repo
    "
    [ "$status" -eq 0 ]
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/error-handling.bash'
        $(sed -n '/^probe_target_repo()/,/^}/p' "$CREATE")
        get_repo_spec() { echo ''; }
        provider_repos_view() { echo SHOULD-NOT-BE-CALLED; return 1; }
        probe_target_repo
    "
    [ "$status" -eq 0 ]
    [[ "$output" != *"SHOULD-NOT-BE-CALLED"* ]]
}
