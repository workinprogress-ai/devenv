#!/usr/bin/env bats
# Consumers that build or consume a repo spec and run under `set -u`: project-add-issue
# (the issue URL must follow the same repo resolution as every other call, and its
# failure path must report instead of dying on an unbound variable) and issue-triage
# (the milestone list targets the resolved repo, and the interactive menus read the
# terminal, not the issue list that is being iterated).

bats_require_minimum_version 1.5.0

load ../test_helper

ADD_ISSUE="$BATS_TEST_DIRNAME/../../scripts/project-add-issue.sh"
TRIAGE="$BATS_TEST_DIRNAME/../../scripts/issue-triage.ts"

setup() {
    test_helper_setup
    export DEVENV_TOOLS="$PROJECT_ROOT/tools"
}

teardown() {
    test_helper_teardown
}

# extract <script> <function>... prints those function bodies
extract() {
    local script="$1"; shift
    local fn
    for fn in "$@"; do
        sed -n "/^${fn}()/,/^}/p" "$script"
    done
}

# ---------------------------------------------------------------------------
# project-add-issue
# ---------------------------------------------------------------------------

@test "project-add-issue: the issue URL is read from the resolved repo, not an org plus cwd guess" {
    run bash -c "
        set -u
        $(extract "$ADD_ISSUE" get_issue_url)
        provider_repo_target() { echo SPEC-FROM-TARGET; }
        provider_issues_view() { printf 'repo=%s number=%s' \"\$1\" \"\$2\"; }
        get_issue_url 42
    "
    [ "$status" -eq 0 ]
    [ "$output" = "repo=SPEC-FROM-TARGET number=42" ]
}

@test "project-add-issue: a failed add reports the provider error and returns 1 under set -u" {
    run bash -c "
        set -u
        source '$PROJECT_ROOT/tools/lib/error-handling.bash'
        $(extract "$ADD_ISSUE" add_issue_to_project)
        DRY_RUN=0; PROJECT_NAME=Board; FIELD_VALUES=()
        get_repo_owner() { echo the-owner; }
        get_issue_url() { echo https://example.test/issues/42; }
        log_verbose() { :; }
        provider_projects_item_add() { echo 'provider said: no such project' >&2; return 1; }
        add_issue_to_project 42
    "
    [ "$status" -eq 1 ]
    [[ "$output" != *"unbound variable"* ]]
    [[ "$output" == *"Failed to add issue #42"* ]]
    [[ "$output" == *"no such project"* ]]
}

@test "project-add-issue: a successful add returns 0" {
    run bash -c "
        set -u
        source '$PROJECT_ROOT/tools/lib/error-handling.bash'
        $(extract "$ADD_ISSUE" add_issue_to_project)
        DRY_RUN=0; PROJECT_NAME=Board; FIELD_VALUES=()
        get_repo_owner() { echo the-owner; }
        get_issue_url() { echo https://example.test/issues/42; }
        log_verbose() { :; }
        provider_projects_item_add() { return 0; }
        add_issue_to_project 42
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"Added issue #42"* ]]
}

# ---------------------------------------------------------------------------
# issue-triage (TypeScript port)
# ---------------------------------------------------------------------------

@test "issue-triage: bundle edits target the resolved repo spec" {
    mkdir -p "$TEST_TEMP_DIR/bin"
    cat > "$TEST_TEMP_DIR/bin/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$TRIAGE_LOG"
exit 0
STUB
    # The bundle path runs the target-repo guard first; answer the toplevel
    # probe with a non-devenv directory so the run reaches the provider call.
    cat > "$TEST_TEMP_DIR/bin/git" <<GITSTUB
#!/usr/bin/env bash
[ "\$1" = "rev-parse" ] && { echo "$TEST_TEMP_DIR"; exit 0; }
exit 0
GITSTUB
    chmod +x "$TEST_TEMP_DIR/bin/gh" "$TEST_TEMP_DIR/bin/git"
    export TRIAGE_LOG="$TEST_TEMP_DIR/gh-calls.log"
    : > "$TRIAGE_LOG"
    export DEVENV_REPO="my-proj/my-repo"
    run env PATH="$TEST_TEMP_DIR/bin:$PATH" node "$PROJECT_ROOT/tools/scripts/issue-triage.ts" 42 --milestone 7
    [ "$status" -eq 0 ]
    grep -q "issue edit 42 -R my-proj/my-repo --milestone 7" "$TRIAGE_LOG"
}

@test "issue-triage: the interactive wizard is refused without a TTY" {
    run env DEVENV_REPO="my-proj/my-repo" node "$PROJECT_ROOT/tools/scripts/issue-triage.ts" < /dev/null
    [ "$status" -eq 2 ]
    [[ "$output" == *"interactive terminal"* ]]
}
