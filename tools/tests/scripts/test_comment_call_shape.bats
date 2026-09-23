#!/usr/bin/env bats
# Call-shape lock for the comment wrappers: issue-comment and pr-comment must
# hand the facade verbs repo-positionally (or empty for cwd resolution),
# number second, body flags after. Regression lock for the scrambled-argv bug
# where the first element of the prebuilt gh_args array was duplicated into
# the verb's optional-repo slot.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

setup() {
    test_helper_setup
    export STUB_CALL_LOG TEST_TEMP_DIR
    unset _PROVIDER_CORE_LOADED PROVIDER_NAME PROVIDER_CAPABILITIES || true
    stub_gh
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    provider_detect "$TEST_TEMP_DIR/absent.config"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/issues.bash"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/prs.bash"
}

# Exercise the fixed post_comment invocation core inline: the suite shell
# already has the provider modules loaded, so the extraction logic and the
# facade call run where they are directly observable via the stub log.
_run_issue_comment_core() {
    local repo_spec_str="$1"
    read -ra repo_spec <<< "$repo_spec_str"
    local comment_args=(--body "hello world")
    local repo="${repo_spec[1]:-}"
    if [ "${repo_spec[0]:-}" != "-R" ]; then
        repo=""
    fi
    provider_issues_comment "$repo" 123 "${comment_args[@]}"
}

@test "issue comment shape: repo present yields single -R with owner/repo" {
    gh_calls_reset
    run _run_issue_comment_core "-R org/repo"
    [ "$status" -eq 0 ]
    gh_last_call_equals "issue comment 123 -R org/repo --body hello world"
}

@test "issue comment shape: no repo yields no -R at all" {
    gh_calls_reset
    run _run_issue_comment_core ""
    [ "$status" -eq 0 ]
    gh_last_call_equals "issue comment 123 --body hello world"
}

@test "pr comment shape: repo present yields single -R with owner/repo (verb contract)" {
    local repo_spec_str="-R org/repo"
    local repo="org/repo"
    local pr_number=9
    gh_calls_reset
    provider_prs_comment "$repo" "$pr_number" --body "hello world"
    gh_last_call_equals "pr comment 9 -R org/repo --body hello world"
}

@test "pr comment shape: no repo yields no -R at all (verb contract)" {
    gh_calls_reset
    provider_prs_comment "" 9 --body "hello world"
    gh_last_call_equals "pr comment 9 --body hello world"
}
