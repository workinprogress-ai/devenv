#!/usr/bin/env bats
# URL seams that give every consumer the provider's own spec and web links, so no
# script has to know a host's path vocabulary:
#   provider_remote_to_spec  a git remote URL -> the repo spec in the provider's form
#                            (GitHub owner/repo, Azure project/repo)
#   provider_pr_web_url      SPEC NUMBER -> the pull request's page
#   provider_issue_web_url   SPEC NUMBER -> the issue or work item's page
# The Azure remote parser also reads <org>.visualstudio.com remotes, the form this
# workspace's own origin uses.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$DEVENV_ROOT"
    printf '[provider]\nname=azure\nazure_org=cfg-org\nazure_project=cfg-proj\n' > "$DEVENV_ROOT/devenv.config"
}

teardown() {
    test_helper_teardown
}

# gh_run / az_run <function> [args]: load one provider's URL module and call the seam
gh_run() {
    run bash -c "
        source \"\$DEVENV_TOOLS/lib/providers/provider-core.bash\"
        PROVIDER_NAME=github
        source \"\$DEVENV_TOOLS/lib/providers/github/urls.bash\"
        \"\$@\"
    " _ "$@"
}
az_run() {
    run bash -c "
        source \"\$DEVENV_TOOLS/lib/providers/provider-core.bash\"
        PROVIDER_NAME=azure
        source \"\$DEVENV_TOOLS/lib/providers/azure/urls.bash\"
        \"\$@\"
    " _ "$@"
}

# ---------------------------------------------------------------------------
# GitHub
# ---------------------------------------------------------------------------

@test "github remote_to_spec: https, ssh and credential-embedded remotes yield owner/repo" {
    gh_run provider_remote_to_spec "https://github.com/org/repo.git"
    [ "$status" -eq 0 ]; [ "$output" = "org/repo" ]
    gh_run provider_remote_to_spec "git@github.com:org/repo.git"
    [ "$status" -eq 0 ]; [ "$output" = "org/repo" ]
    gh_run provider_remote_to_spec "https://user:tok@github.com/org/repo"
    [ "$status" -eq 0 ]; [ "$output" = "org/repo" ]
}

@test "github remote_to_spec: another host's remote is not ours" {
    gh_run provider_remote_to_spec "https://gitlab.com/org/repo.git"
    [ "$status" -ne 0 ]
    [ -z "$output" ]
}

@test "github pr and issue web urls follow GitHub's paths" {
    gh_run provider_pr_web_url org/repo 12
    [ "$status" -eq 0 ]; [ "$output" = "https://github.com/org/repo/pull/12" ]
    gh_run provider_issue_web_url org/repo 7
    [ "$status" -eq 0 ]; [ "$output" = "https://github.com/org/repo/issues/7" ]
}

@test "github web urls require a spec and a number" {
    gh_run provider_pr_web_url "" 12
    [ "$status" -ne 0 ]
    gh_run provider_issue_web_url org/repo ""
    [ "$status" -ne 0 ]
}

# ---------------------------------------------------------------------------
# Azure
# ---------------------------------------------------------------------------

@test "azure remote_to_spec: every remote form yields the two-part project/repo" {
    az_run provider_remote_to_spec "https://dev.azure.com/o/p/_git/r"
    [ "$status" -eq 0 ]; [ "$output" = "p/r" ]
    az_run provider_remote_to_spec "https://dev.azure.com/o/p/_git/r.git"
    [ "$status" -eq 0 ]; [ "$output" = "p/r" ]
    az_run provider_remote_to_spec "git@ssh.dev.azure.com:v3/o/p/r"
    [ "$status" -eq 0 ]; [ "$output" = "p/r" ]
    az_run provider_remote_to_spec "https://user@dev.azure.com/o/p/_git/r"
    [ "$status" -eq 0 ]; [ "$output" = "p/r" ]
}

@test "azure remote_to_spec reads an <org>.visualstudio.com remote" {
    az_run provider_remote_to_spec "https://myorg.visualstudio.com/myproj/_git/myrepo"
    [ "$status" -eq 0 ]
    [ "$output" = "myproj/myrepo" ]
    az_run provider_remote_to_spec "https://tok@myorg.visualstudio.com/myproj/_git/myrepo"
    [ "$status" -eq 0 ]
    [ "$output" = "myproj/myrepo" ]
}

@test "azure remote_to_web normalizes a visualstudio.com remote to the dev.azure.com form" {
    az_run provider_remote_to_web "https://myorg.visualstudio.com/myproj/_git/myrepo"
    [ "$status" -eq 0 ]
    [ "$output" = "https://dev.azure.com/myorg/myproj/_git/myrepo" ]
}

@test "azure remote_to_spec: a GitHub remote is not ours" {
    az_run provider_remote_to_spec "git@github.com:org/repo.git"
    [ "$status" -ne 0 ]
    [ -z "$output" ]
}

@test "azure pr web url: a project/repo spec takes the organization from config" {
    az_run provider_pr_web_url proj/repo 12
    [ "$status" -eq 0 ]
    [ "$output" = "https://dev.azure.com/cfg-org/proj/_git/repo/pullrequest/12" ]
}

@test "azure pr web url: an org/project/repo spec carries its own organization" {
    az_run provider_pr_web_url o/p/r 12
    [ "$status" -eq 0 ]
    [ "$output" = "https://dev.azure.com/o/p/_git/r/pullrequest/12" ]
}

@test "azure issue web url is the work item page of the project" {
    az_run provider_issue_web_url proj/repo 7
    [ "$status" -eq 0 ]
    [ "$output" = "https://dev.azure.com/cfg-org/proj/_workitems/edit/7" ]
}

@test "azure web urls require a spec and a number" {
    az_run provider_pr_web_url "" 12
    [ "$status" -ne 0 ]
    az_run provider_issue_web_url proj/repo ""
    [ "$status" -ne 0 ]
}
