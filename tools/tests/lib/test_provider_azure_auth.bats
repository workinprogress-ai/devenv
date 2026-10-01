#!/usr/bin/env bats
# Azure git-transport credentials: the credential helper and the
# provider_auth_setup_git seam wiring.
#
# All git-config writes happen under GIT_CONFIG_GLOBAL pointed at a temp
# file — never the executor's real global config. No network: the helper is
# exercised via `git credential fill` with a piped protocol query.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    export AZURE_PAT_FILE="$TEST_TEMP_DIR/azure.pat"
    export GIT_CONFIG_GLOBAL="$TEST_TEMP_DIR/gitconfig"
    : > "$GIT_CONFIG_GLOBAL"
    printf 'azure-pat-token-abcdefghij0123456789' > "$AZURE_PAT_FILE"
    chmod 600 "$AZURE_PAT_FILE"
}

teardown() {
    unset AZURE_PAT_FILE GIT_CONFIG_GLOBAL
    test_helper_teardown
}

@test "azure credential helper: get emits protocol fields with the PAT" {
    run bash -c "
        printf 'protocol=https\nhost=dev.azure.com\n\n' | \
        '$DEVENV_TOOLS/lib/providers/azure/credential-helper.sh' get
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"username=oauth"* ]]
    [[ "$output" == *"password=azure-pat-token-abcdefghij0123456789"* ]]
}

@test "azure credential helper: store/erase are refusals-by-no-op (no second copy)" {
    run bash -c "
        printf 'protocol=https\nhost=dev.azure.com\nusername=x\npassword=y\n\n' | \
        '$DEVENV_TOOLS/lib/providers/azure/credential-helper.sh' store
    "
    [ "$status" -eq 0 ]
    # No credential-store file may appear anywhere git would write one.
    [ ! -f "$HOME/.git-credentials" ]
}

@test "azure credential helper: missing PAT file errors defined" {
    rm -f "$AZURE_PAT_FILE"
    run bash -c "
        printf 'protocol=https\nhost=dev.azure.com\n\n' | \
        '$DEVENV_TOOLS/lib/providers/azure/credential-helper.sh' get
    "
    [ "$status" -ne 0 ]
    [[ "$output" == *"PAT file not found"* ]]
}

@test "provider_auth_setup_git: registers a host-scoped helper for dev.azure.com only" {
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load auth
        provider_auth_setup_git
    "
    [ "$status" -eq 0 ]
    local gitcfg="$GIT_CONFIG_GLOBAL"
    # git writes URL-scoped helpers as a [credential "URL"] section with a
    # helper key, not a dotted credential.<url>.helper line.
    grep -qA2 'credential "https://dev.azure.com"' "$gitcfg"
    ! grep -q 'credential "https://github.com"' "$gitcfg"
}

@test "provider_auth_setup_git: git credential fill yields the PAT for dev.azure.com and not github.com" {
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load auth
        provider_auth_setup_git
        printf 'protocol=https\nhost=dev.azure.com\n\n' | git credential fill
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"password=azure-pat-token-abcdefghij0123456789"* ]]

    # The github.com query must NOT resolve through the azure helper (the
    # helper errors on a missing-file basis only for its own host scope;
    # here the config simply has no github entry, so git finds no helper).
    run bash -c "
        export GIT_CONFIG_GLOBAL='$GIT_CONFIG_GLOBAL'
        printf 'protocol=https\nhost=github.com\n\n' | git credential fill
    "
    [[ "$output" != *"azure-pat-token"* ]]
}

@test "provider_auth_setup_git: key-update-azure invokes the wiring after import" {
    # Contract check: the rotation script's wiring step exists and runs the
    # seam verb (full rotation flow is covered by test_key_update.bats).
    grep -q "provider_auth_setup_git" "$DEVENV_TOOLS/lib/providers/azure/key-update.sh"
}
