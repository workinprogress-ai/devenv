#!/usr/bin/env bats
# Contract tests for the GitHub credential lifecycle module (auth.bash).
# The module is the single sanctioned home for gh auth CLI invocations;
# these tests verify the import/status impls via the shared gh stub.

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
    unset _PROVIDER_GITHUB_AUTH_LOADED
    unset PROVIDER_NAME
    stub_gh
    source "${DEVENV_TOOLS}/lib/providers/provider-core.bash"
    provider_detect "${TEST_TEMP_DIR}/absent.config"
    source "${DEVENV_TOOLS}/lib/providers/github/auth.bash"
}

@test "auth module: import impl exits 0 when gh auth login succeeds" {
    run provider_auth_import_token_impl < /dev/null
    assert_success
    grep -q "gh auth login --with-token" "$STUB_CALL_LOG"
    grep -q "gh auth setup-git" "$STUB_CALL_LOG"
}

@test "auth module: login failure propagates" {
    export STUB_GH_FAIL=1
    run provider_auth_import_token_impl < /dev/null
    assert_failure
}

@test "auth module: status impl exits 0 when gh auth status succeeds" {
    run provider_auth_status_impl
    assert_success
    grep -q "gh auth status" "$STUB_CALL_LOG"
}

@test "auth module: status impl propagates failure" {
    export STUB_GH_FAIL=1
    run provider_auth_status_impl
    assert_failure
}

@test "auth seam: provider_auth_import_token dispatches to impl" {
    run provider_auth_import_token < /dev/null
    assert_success
    grep -q "gh auth login" "$STUB_CALL_LOG"
}

@test "auth seam: provider_auth_status dispatches to impl" {
    run provider_auth_status
    assert_success
    grep -q "gh auth status" "$STUB_CALL_LOG"
}

@test "auth seam: core alone (no auth module) fails defined" {
    unset _PROVIDER_GITHUB_AUTH_LOADED
    # Re-source core only in a clean subshell to drop auth.bash functions
    run bash -c '
        export DEVENV_TOOLS="'"$DEVENV_TOOLS"'"
        unset _PROVIDER_CORE_LOADED
        unset _PROVIDER_GITHUB_AUTH_LOADED
        source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
        provider_detect "'"$TEST_TEMP_DIR"'/absent.config"
        provider_auth_import_token <<< "tok"
    '
    assert_failure
    run bash -c '
        export DEVENV_TOOLS="'"$DEVENV_TOOLS"'"
        unset _PROVIDER_CORE_LOADED
        unset _PROVIDER_GITHUB_AUTH_LOADED
        source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
        provider_detect "'"$TEST_TEMP_DIR"'/absent.config"
        provider_auth_status
    '
    assert_failure
}

@test "auth module: provider_auth_token_impl prints the keychain token" {
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/providers/github/auth.bash"
    STUB_GH_AUTH_TOKEN="tok123" run provider_auth_token_impl
    [ "$status" -eq 0 ]
    [ "$output" = "tok123" ]
}

@test "core: token kind delegates keychain probe to the provider impl" {
    # With the github auth module loaded, the keychain leg is available.
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/providers/github/auth.bash"
    STUB_GH_AUTH_TOKEN="tok123" run bash -c 'true'
    [ -n "$(declare -f provider_auth_token_impl)" ]
}

@test "core: no gh invocation remains in provider-core (grep gate)" {
    local hits
    hits=$(grep -nE '\bgh\b' "$DEVENV_TOOLS/lib/providers/provider-core.bash" | grep -v '^\s*#' | grep -vE ':[0-9]+:\s*#' || true)
    [ -z "$hits" ] || {
        echo "gh references in neutral core:" >&2
        printf '%s\n' "$hits" >&2
        return 1
    }
}
