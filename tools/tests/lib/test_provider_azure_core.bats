#!/usr/bin/env bats
# Tests for the azure provider foundation: PAT file lifecycle (auth module),
# config-driven provider detection, and key-update-azure.
#
# All credential tests run against a temp PAT file (AZURE_PAT_FILE override) —
# nothing here reads or writes the user's real devenv config area.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

setup() {
    test_helper_setup
    export STUB_CALL_LOG
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$DEVENV_ROOT"
    export AZURE_PAT_FILE="$TEST_TEMP_DIR/azure.pat"
    unset _PROVIDER_CORE_LOADED || true
    unset PROVIDER_NAME || true
    export AZURE_TEST_LIBS="source '$DEVENV_TOOLS/lib/providers/provider-core.bash'; PROVIDER_NAME=azure; provider_load auth"
}

teardown() {
    unset AZURE_PAT_FILE
    unset DEVENV_ROOT
    test_helper_teardown
}

# ===========================================================================
# PAT file lifecycle
# ===========================================================================

@test "azure auth: import creates 0600 PAT file and token impl reads it back" {
    run bash -c "
        $AZURE_TEST_LIBS
        printf 'my-azure-pat-abc123' | provider_auth_import_token_impl
    "
    [ "$status" -eq 0 ]
    [ -f "$AZURE_PAT_FILE" ]
    [ "$(stat -c '%a' "$AZURE_PAT_FILE")" = "600" ]
    run bash -c "
        $AZURE_TEST_LIBS
        provider_auth_token_impl
    "
    [ "$status" -eq 0 ]
    [ "$output" = "my-azure-pat-abc123" ]
}

@test "azure auth: import refuses an empty token" {
    run bash -c "
        $AZURE_TEST_LIBS
        printf '' | provider_auth_import_token_impl
    "
    [ "$status" -ne 0 ]
    [ ! -f "$AZURE_PAT_FILE" ]
}

@test "azure auth: token impl refuses a PAT file with loose mode" {
    printf 'pat\n' > "$AZURE_PAT_FILE"
    chmod 644 "$AZURE_PAT_FILE"
    run bash -c "
        $AZURE_TEST_LIBS
        provider_auth_token_impl
    "
    [ "$status" -ne 0 ]
    [[ "$output" =~ "expected 600" ]]
    [[ "$output" =~ "chmod 600" ]]
}

@test "azure auth: status succeeds with valid file, fails without" {
    run bash -c "
        $AZURE_TEST_LIBS
        provider_auth_status_impl
    "
    [ "$status" -ne 0 ]

    printf 'pat\n' | bash -c "
        $AZURE_TEST_LIBS
        provider_auth_import_token_impl && provider_auth_status_impl
    "
}

# ===========================================================================
# Provider detection via devenv.config
# ===========================================================================

@test "provider_detect selects azure from [provider] name=azure" {
    printf '[provider]\nname=azure\nazure_org=myorg\nazure_project=myproj\n' > "$DEVENV_ROOT/devenv.config"
    run bash -c "
        export DEVENV_TOOLS=\"$DEVENV_TOOLS\"
        export DEVENV_ROOT=\"$DEVENV_ROOT\"
        source \"$DEVENV_TOOLS/lib/providers/provider-core.bash\"
        provider_detect
        echo \"DETECTED=\$PROVIDER_NAME\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" =~ DETECTED=azure$ ]]
}

@test "provider_detect defaults to github when no provider key" {
    printf '[organization]\nname=test\n' > "$DEVENV_ROOT/devenv.config"
    run bash -c "
        export DEVENV_TOOLS=\"$DEVENV_TOOLS\"
        export DEVENV_ROOT=\"$DEVENV_ROOT\"
        source \"$DEVENV_TOOLS/lib/providers/provider-core.bash\"
        provider_detect
        echo \"DETECTED=\${PROVIDER_NAME:-none}\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" =~ DETECTED=github$ ]]
}

@test "provider_load skips absent azure domain modules with a warning (fails defined)" {
    printf '[provider]\nname=azure\n' > "$DEVENV_ROOT/devenv.config"
    run bash -c "
        export DEVENV_TOOLS=\"$DEVENV_TOOLS\"
        export DEVENV_ROOT=\"$DEVENV_ROOT\"
        source \"$DEVENV_TOOLS/lib/providers/provider-core.bash\"
        provider_detect
        provider_load prs
        declare -F provider_prs_list >/dev/null && echo IMPLEMENTED || echo ABSENT
    "
    [ "$status" -eq 0 ]
    # prs is implemented for azure — absent modules must warn-and-skip,
    # never crash, but this one must actually load.
    [[ "$output" =~ IMPLEMENTED ]]
}

@test "azure auth module is discoverable by provider_load auth" {
    printf '[provider]\nname=azure\n' > "$DEVENV_ROOT/devenv.config"
    run bash -c "
        export DEVENV_TOOLS=\"$DEVENV_TOOLS\"
        export DEVENV_ROOT=\"$DEVENV_ROOT\"
        source \"$DEVENV_TOOLS/lib/providers/provider-core.bash\"
        provider_detect
        provider_load auth
        declare -F provider_auth_token_impl >/dev/null && echo LOADED
    "
    [ "$status" -eq 0 ]
    [ "$output" = "LOADED" ]
}

# ===========================================================================
# key-update-azure
# ===========================================================================

@test "key-update-azure --help explains usage and never prompts" {
    run bash "$DEVENV_TOOLS/lib/providers/azure/key-update.sh" --help < /dev/null
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Usage: key-update-azure" ]]
    [[ "$output" =~ "Azure DevOps personal access token" ]]
}

@test "key-update-azure stores a token passed as argument" {
    run bash "$DEVENV_TOOLS/lib/providers/azure/key-update.sh" "arg-pat-xyz" < /dev/null
    [ "$status" -eq 0 ]
    [ -f "$AZURE_PAT_FILE" ]
    [ "$(stat -c '%a' "$AZURE_PAT_FILE")" = "600" ]
    grep -q "arg-pat-xyz" "$AZURE_PAT_FILE"
}

@test "key-update-azure rejects an empty token" {
    run bash "$DEVENV_TOOLS/lib/providers/azure/key-update.sh" "" < /dev/null
    [ "$status" -ne 0 ]
}

@test "provider_org_releases_list emits one JSON array and honors --json" {
    stub_curl
    export AZURE_DEVOPS_ORG=o1 AZURE_DEVOPS_PROJECT=p1
    printf 'test-pat\n' > "$AZURE_PAT_FILE"
    chmod 600 "$AZURE_PAT_FILE"
    printf '{"value":[{"name":"refs/tags/v1.0.0","creator":{"date":"2026-09-01T10:00:00Z"}},{"name":"refs/tags/v2.0.0-beta.1","creator":{"date":"2026-09-02T10:00:00Z"}}]}' > "$TEST_TEMP_DIR/tags.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/tags.json" \
        run bash -c "$AZURE_TEST_LIBS; provider_load repos releases; provider_org_releases_list o1/p1/r1 --json tagName,isPrerelease"
    [ "$status" -eq 0 ]
    # One JSON array; table mode's .[] select works over it; the projection
    # keeps exactly the requested fields.
    jq -e 'length == 2 and .[0].tagName == "v1.0.0" and .[0].isPrerelease == false and .[1].isPrerelease == true and (.[0] | keys | sort) == ["isPrerelease","tagName"]' <<< "$output" >/dev/null
}
