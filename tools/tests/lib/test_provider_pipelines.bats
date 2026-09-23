#!/usr/bin/env bats
# Contract tests for the github actions domain facade.

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
    source "$DEVENV_TOOLS/lib/providers/github/pipelines.bash"
}

@test "actions module: loads, registers pipelines capability, idempotent" {
    provider_has_capability pipelines
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/github/pipelines.bash"
    declare -F provider_pipelines_run_list >/dev/null
}

@test "run list: -R repo and flags pass through" {
    run provider_pipelines_run_list org/repo --branch main --limit 5
    assert_success
    grep -q "^gh run list -R org/repo --branch main --limit 5$" "$STUB_CALL_LOG"
}

@test "run view: run id and repo wired" {
    run provider_pipelines_run_view org/repo 12345
    assert_success
    grep -q "^gh run view 12345 -R org/repo$" "$STUB_CALL_LOG"
}

@test "run watch: polling stays domain-local with repo wiring" {
    run provider_pipelines_run_watch org/repo 42
    assert_success
    grep -q "^gh run watch 42 -R org/repo$" "$STUB_CALL_LOG"
}

@test "workflow list: passes repo" {
    run provider_pipelines_workflow_list org/repo
    assert_success
    grep -q "^gh workflow list -R org/repo$" "$STUB_CALL_LOG"
}

@test "run artifacts: REST endpoint wired with jq extraction" {
    printf '{"artifacts":[{"name":"a"}]}' > "$TEST_TEMP_DIR/api.json"
    export STUB_GH_API_RESPONSE="$TEST_TEMP_DIR/api.json"
    run provider_pipelines_run_artifacts org/repo 77
    assert_success
    grep -q "^gh api /repos/org/repo/actions/runs/77/artifacts --jq .artifacts$" "$STUB_CALL_LOG"
}

@test "workflow run: dispatch wired with workflow name and repo" {
    run provider_pipelines_workflow_run org/repo build.yml --ref main
    assert_success
    grep -q "^gh workflow run build.yml -R org/repo --ref main$" "$STUB_CALL_LOG"
}

@test "run rerun: run id and repo wired" {
    run provider_pipelines_run_rerun org/repo 99
    assert_success
    grep -q "^gh run rerun 99 -R org/repo$" "$STUB_CALL_LOG"
}

@test "run cancel: -R form per inventory (provider-loader parity)" {
    run provider_pipelines_run_cancel org/repo 55
    assert_success
    grep -q "^gh run cancel -R org/repo 55$" "$STUB_CALL_LOG"
}

@test "run download: run id, repo, flags wired" {
    run provider_pipelines_run_download org/repo 77 --name art
    assert_success
    grep -q "^gh run download 77 -R org/repo --name art$" "$STUB_CALL_LOG"
}

@test "wait_for_branch: returns 0 immediately when no active runs" {
    printf '[{"status":"completed"}]' > "$TEST_TEMP_DIR/api.json"
    export STUB_GH_API_RESPONSE="$TEST_TEMP_DIR/api.json"
    run provider_pipelines_wait_for_branch org/repo main 3
    assert_success
}

@test "wait_for_branch: query failure aborts with defined error" {
    # The cli-stubs gh serves canned output only for `gh api`, so the poller's
    # `gh run list` surface is exercised for failure via STUB_GH_FAIL: the
    # poller must treat a failed query as abort (not as "branch settled").
    stub_gh
    STUB_GH_FAIL=1 run provider_pipelines_wait_for_branch org/repo main 2
    assert_failure
    [[ "$output" == *"could not query runs"* ]]
}


@test "run view: bare number first arg is the run id, not a repo (regex guard)" {
    gh_calls_reset
    provider_pipelines_run_view "55" --json url
    gh_last_call_equals "run view 55 --json url"
}

@test "run view: flags pass through after the run id" {
    gh_calls_reset
    provider_pipelines_run_view "org/repo" "55" --json url
    gh_last_call_equals "run view 55 -R org/repo --json url"
}
