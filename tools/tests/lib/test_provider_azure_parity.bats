#!/usr/bin/env bats
# Parity ledger: the azure provider verb inventory as an executable test.
#
# The ledger is one monotone IMPLEMENTED list: every verb that must be
# defined after provider_load. This is the regression net — any verb that
# later goes missing fails the suite. New verbs are added here as they
# land; removals are deliberate and must be justified in the diff.
#
# provider_api / provider_api_paginate are github-only machinery (call
# sites are rewritten to domain verbs, never implemented under azure) and
# are deliberately absent from this ledger. Azure-specific extras
# (verbs with no github counterpart) sit in the same list.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$DEVENV_ROOT"
    unset _PROVIDER_CORE_LOADED || true
    unset PROVIDER_NAME || true
}

teardown() {
    unset DEVENV_ROOT
    test_helper_teardown
}

# Emit the canonical azure provider load sequence as a command string
# for bash -c subshells (DEVENV_TOOLS is set in setup).
_azure_load_cmds() {
    echo "source '$DEVENV_TOOLS/lib/providers/provider-core.bash'; PROVIDER_NAME=azure; provider_load http urls auth repos issues prs pipelines projects org"
}

# Verbs the azure provider implements today. Regression net — a verb
# listed here that fails to load is a parity regression.
AZURE_IMPLEMENTED=(
    # issues domain
    provider_issues_close
    provider_issues_comment
    provider_issues_comment_add
    provider_issues_comment_edit
    provider_issues_comment_get
    provider_issues_comments
    provider_issues_create
    provider_issues_edit
    provider_issues_exists
    provider_issue_graph_children
    provider_issue_graph_link
    provider_issue_graph_parent
    provider_issue_graph_unlink
    provider_issues_label_create
    provider_issues_label_ensure
    provider_issues_add_tag
    provider_issues_label_list
    provider_issues_label_update
    provider_issues_list
    provider_issues_milestones
    provider_issues_reopen
    provider_issues_set_type
    provider_issues_view
    provider_org_issue_types
    # projects / boards domain
    provider_projects_field_list
    provider_projects_field_option_ids
    provider_projects_field_set
    provider_projects_for_issue
    provider_projects_id_by_name
    provider_projects_item_add
    provider_projects_item_id_for_issue
    provider_projects_list
    # pipelines domain
    provider_pipelines_run_artifacts
    provider_pipelines_run_cancel
    provider_pipelines_run_download
    provider_pipelines_run_list
    provider_pipelines_run_rerun
    provider_pipelines_run_view
    provider_pipelines_run_watch
    provider_pipelines_wait_for_branch
    provider_pipelines_workflow_list
    provider_pipelines_workflow_run
    # prs domain
    provider_prs_comment
    provider_prs_create
    provider_prs_diff
    provider_prs_list
    provider_prs_merge
    provider_prs_thread_create
    provider_prs_thread_reply
    provider_prs_thread_resolve
    provider_prs_threads_page
    provider_prs_view
    # repos domain (reads + identity + provisioning)
    provider_repos_create
    provider_repos_edit
    provider_repos_list
    provider_repos_patch
    provider_repos_protect_branch
    provider_repos_team_put
    provider_repos_collaborator_put
    provider_repos_view
    provider_repos_commits_count
    provider_repos_default_branch
    provider_repo_target
    provider_repo_split
    provider_remote_to_web
    provider_gh_repo_args
    # org domain (rulesets + releases + feeds)
    provider_org_rulesets_list
    provider_org_ruleset_get
    provider_org_ruleset_create
    provider_org_ruleset_update
    provider_org_releases_list
    provider_git_transport_url
    provider_git_remote_base
    provider_extract_url
    provider_org_feeds_list
    # org domain (rulesets + releases + feeds)
    # azure-specific surface (no github counterpart)
    provider_token_kind
    provider_user_get
    provider_web_host
    provider_web_url
)

@test "azure parity: canonical loader sources every azure module cleanly" {
    # Missing-module WARNs for not-yet-existing azure modules (projects,
    # org) are the loader's benign skip path; only ERROR lines fail this.
    run bash -c "$(_azure_load_cmds); echo LOADED"
    [ "$status" -eq 0 ]
    [[ "$output" == *"LOADED"* ]]
    [[ "$output" != *"ERROR"* ]]
}

@test "azure parity: implemented verb inventory is defined" {
    run bash -c "
        $(_azure_load_cmds)
        missing=0
        for verb in ${AZURE_IMPLEMENTED[*]}; do
            if ! declare -F \"\$verb\" >/dev/null; then
                echo \"MISSING: \$verb\"
                missing=1
            fi
        done
        exit \$missing
    "
    [ "$status" -eq 0 ]
}









