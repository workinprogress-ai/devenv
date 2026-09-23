#!/usr/bin/env bats
# Contract tests for the shared test harness itself: the gh argv assertions
# (call-shape harness) and the clean-shell loader-composition helpers. These
# lock the harness primitives that call-shape and loader-contract suites
# build on.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

setup() {
    test_helper_setup
    export STUB_CALL_LOG
    export TEST_TEMP_DIR
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    unset _PROVIDER_CORE_LOADED || true
    unset PROVIDER_NAME || true
    unset PROVIDER_CAPABILITIES || true
    stub_gh
}

@test "harness: gh_last_call_equals matches exact argv" {
    gh run list -R org/repo --limit 5
    gh_last_call_equals "run list -R org/repo --limit 5"
}

@test "harness: gh_last_call_equals fails on drift with diagnostics" {
    gh run list -R org/repo --limit 5
    run gh_last_call_equals "run list -R other/repo --limit 5"
    [ "$status" -ne 0 ]
    [[ "$output" == *"expected:"* && "$output" == *"actual:"* ]]
}

@test "harness: gh_last_call_equals sees only the latest invocation" {
    gh issue view 7 --json number
    gh issue view 8 --json number
    gh_last_call_equals "issue view 8 --json number"
}

@test "harness: gh_calls_contain matches substring across window" {
    gh pr list -R org/repo --state open
    gh issue list -R org/repo --state open
    gh_calls_contain "pr list"
    gh_calls_contain "issue list"
}

@test "harness: gh_calls_reset clears the assertion window" {
    gh run list -R org/repo
    gh_calls_reset
    run gh_calls_contain "run list"
    [ "$status" -ne 0 ]
}

@test "harness: compose_functions_defined passes for loader-provided verbs" {
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/provider-loader.bash" \
        provider_issues_list provider_prs_list provider_repos_view
}

@test "harness: loader composition provides the auth lifecycle (provider_auth_status_impl)" {
    # The loader sources the provider's auth module: without it, auth gating
    # in scripts and the bootstrap seed import fail "does not implement"
    # even when the provider is fully functional.
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/provider-loader.bash" \
        provider_auth_status_impl provider_auth_import_token_impl
}

@test "harness: core-only composition (bootstrap seam shape) also provides auth" {
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/providers/provider-core.bash
provider_detect \"$DEVENV_ROOT/devenv.config\" 2>/dev/null || PROVIDER_NAME=github
source \"\$DEVENV_TOOLS/lib/providers/\${PROVIDER_NAME}/auth.bash\"" \
        provider_auth_status_impl provider_secret_get
}

@test "harness: compose runs in a clean shell (no leakage from the suite)" {
    # The suite shell has provider modules loaded (stub_gh setup does not,
    # but other suites' patterns might); the composition must not inherit
    # them. A nonsense source command must report every probe missing.
    run compose_functions_defined "true" provider_issues_list
    [ "$status" -ne 0 ]
    [[ "$output" == *"provider_issues_list"* ]]
}
