#!/usr/bin/env bats
# Bootstrap sync auth: provider-scheme dispatch for the ephemeral
# extraheader. Pure header construction — no network, no git state.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_ROOT="${BATS_TEST_DIRNAME}/../../.."
    # Extract the two builder functions from bootstrap.bash without
    # executing it (bootstrap is an entry script, not a library).
    BUILDERS=$(bash -c "
        sed -n '/^build_github_basic_auth_header()/,/^}/p; /^build_provider_git_auth_header()/,/^}/p' \
            '$DEVENV_ROOT/.devcontainer/bootstrap.bash'
    ")
    export BUILDERS
}

teardown() {
    unset BUILDERS
    test_helper_teardown
}

@test "github scheme: x-access-token basic header" {
    run bash -c "
        $BUILDERS
        build_provider_git_auth_header github secret-token-1
    "
    [ "$status" -eq 0 ]
    local expected
    expected=$(printf 'x-access-token:%s' "secret-token-1" | base64 -w0)
    [[ "$output" == "AUTHORIZATION: basic $expected" ]]
}

@test "azure scheme: RFC-7617 basic with empty user (':PAT')" {
    run bash -c "
        $BUILDERS
        build_provider_git_auth_header azure secret-token-1
    "
    [ "$status" -eq 0 ]
    local expected
    expected=$(printf ':%s' "secret-token-1" | base64 -w0)
    [[ "$output" == "AUTHORIZATION: Basic $expected" ]]
}

@test "schemes differ for the same token (the dispatch is real)" {
    local gh azure
    gh=$(bash -c "
        $BUILDERS
        build_provider_git_auth_header github secret-token-1
    ")
    azure=$(bash -c "
        $BUILDERS
        build_provider_git_auth_header azure secret-token-1
    ")
    [ "$gh" != "$azure" ]
}

@test "unknown provider falls back to the github leg (policy default)" {
    run bash -c "
        $BUILDERS
        build_provider_git_auth_header gitlab secret-token-1
    "
    [ "$status" -eq 0 ]
    local expected
    expected=$(printf 'x-access-token:%s' "secret-token-1" | base64 -w0)
    [[ "$output" == "AUTHORIZATION: basic $expected" ]]
}
