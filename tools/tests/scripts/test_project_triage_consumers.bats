#!/usr/bin/env bats
# Consumers that build or consume a repo spec and run under `set -u`: project-add-issue
# (the issue URL must follow the same repo resolution as every other call, and its
# failure path must report instead of dying on an unbound variable) and issue-triage
# (the milestone list targets the resolved repo, and the interactive menus read the
# terminal, not the issue list that is being iterated).

bats_require_minimum_version 1.5.0

load ../test_helper

ADD_ISSUE="$BATS_TEST_DIRNAME/../../scripts/project-add-issue.sh"
TRIAGE="$BATS_TEST_DIRNAME/../../scripts/issue-triage.sh"

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
# issue-triage
# ---------------------------------------------------------------------------

@test "issue-triage: the milestone list targets the resolved repo spec" {
    run bash -c "
        set -u
        source '$PROJECT_ROOT/tools/lib/error-handling.bash'
        $(extract "$TRIAGE" set_milestone)
        get_repo_spec() { echo my-proj/my-repo; }
        provider_issues_milestones() { echo \"milestones-for=\$1\"; }
        provider_issues_edit() { echo \"edit repo=\$1 issue=\$2 \$3 \$4\"; }
        printf '7\n' | set_milestone 42
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"milestones-for=my-proj/my-repo"* ]]
    [[ "$output" == *"edit repo=my-proj/my-repo issue=42 --milestone 7"* ]]
}

@test "issue-triage: the wizard's menus read the terminal, not the issue list it iterates" {
    # a pipe into the loop feeds its lines to every `read` inside it
    run ! grep -nE 'echo "\$issues" \| while' "$TRIAGE"
}

@test "issue-triage: link-to-parent writes the existing body unchanged (no backslash interpretation)" {
    run grep -nE 'echo -e' "$TRIAGE"
    [ "$status" -ne 0 ]
}
