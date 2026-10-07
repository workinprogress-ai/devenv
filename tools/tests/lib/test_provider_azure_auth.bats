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
    export GIT_CONFIG_NOSYSTEM=1
    export GIT_CONFIG_COUNT=0
    unset GIT_CONFIG_PARAMETERS
    : > "$GIT_CONFIG_GLOBAL"
    printf 'azure-pat-token-abcdefghij0123456789' > "$AZURE_PAT_FILE"
    sed -i 's/^name=github/name=azure\nazure_org=test-org\nazure_project=test-proj/' "$DEVENV_ROOT/devenv.config"
    chmod 600 "$AZURE_PAT_FILE"
    cd "$TEST_TEMP_DIR"
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

@test "provider_auth_setup_git: registers canonical and organization-scoped helpers" {
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
    grep -qA2 'credential "https://test-org.visualstudio.com"' "$gitcfg"
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
    [[ "$output" != *"username=oauth"* ]]
    [[ "$output" != *"azure-pat-token"* ]]
}

@test "provider_auth_setup_git: visualstudio.com host credential query returns the synthetic PAT" {
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load auth
        provider_auth_setup_git
        printf 'protocol=https\nhost=test-org.visualstudio.com\n\n' | git credential fill
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"username=oauth"* ]]
    [[ "$output" == *"password=azure-pat-token-abcdefghij0123456789"* ]]
}

@test "provider_auth_setup_git: unrelated visualstudio.com hosts never receive Azure credentials" {
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load auth
        provider_auth_setup_git
        printf 'protocol=https\nhost=other-org.visualstudio.com\n\n' | git credential fill
        printf 'protocol=https\nhost=test-org.visualstudio.com.example.com\n\n' | git credential fill
    "
    [[ "$output" != *"username=oauth"* ]]
    [[ "$output" != *"azure-pat-token"* ]]
}

@test "provider_auth_setup_git: configured organization casing is normalized" {
    sed -i 's/org=test-org/org=MiXeD-OrG/' "$DEVENV_ROOT/devenv.config"
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load auth
        provider_auth_setup_git
        git config --get-urlmatch credential.helper https://mixed-org.visualstudio.com/
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"azure/credential-helper.sh get"* ]]
}

@test "provider_auth_setup_git: repeated registration preserves unrelated configuration" {
    git config --global credential.https://example.com.username unrelated-user
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load auth
        provider_auth_setup_git
        provider_auth_setup_git
    "
    [ "$status" -eq 0 ]
    [ "$(git config --get-all credential.https://dev.azure.com.helper | wc -l)" -eq 1 ]
    [ "$(git config --get-all credential.https://test-org.visualstudio.com.helper | wc -l)" -eq 1 ]
    [ "$(git config --get credential.https://example.com.username)" = "unrelated-user" ]
}

@test "provider_auth_setup_git: missing azure_org keeps canonical support and warns" {
    sed -i '/^azure_org=/d' "$DEVENV_ROOT/devenv.config"
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load auth
        provider_auth_setup_git
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"visualstudio.com host"* ]]
    git config --get credential.https://dev.azure.com.helper
    ! grep -q visualstudio.com "$GIT_CONFIG_GLOBAL"
}

@test "provider_auth_setup_git: wildcard organization never broadens credential scope" {
    sed -i 's/^azure_org=test-org/azure_org=test*/' "$DEVENV_ROOT/devenv.config"
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load auth
        provider_auth_setup_git
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"invalid organization identity"* ]]
    git config --get credential.https://dev.azure.com.helper
    ! grep -q visualstudio.com "$GIT_CONFIG_GLOBAL"
}

@test "provider_auth_setup_git: the visualstudio.com host derives from azure_org, not [organization] org" {
    sed -i 's/^org=test-org/org=display-org/' "$DEVENV_ROOT/devenv.config"
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load auth
        provider_auth_setup_git
    "
    [ "$status" -eq 0 ]
    git config --get credential.https://test-org.visualstudio.com.helper
    run ! git config --get credential.https://display-org.visualstudio.com.helper
}

@test "provider_auth_import_token: wires the git credential helper after storing the PAT" {
    rm -f "$AZURE_PAT_FILE"
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load auth
        printf 'imported-pat-0123456789' | provider_auth_import_token
    "
    [ "$status" -eq 0 ]
    [ "$(stat -c '%a' "$AZURE_PAT_FILE")" = "600" ]
    git config --get credential.https://dev.azure.com.helper
    git config --get credential.https://test-org.visualstudio.com.helper
}

@test "key-update-azure leaves the git helper wiring to the credential import" {
    # The import verb wires the helper (see the import test above); the rotation
    # script must not wire it a second time.
    run ! grep -q "provider_auth_setup_git" "$DEVENV_TOOLS/lib/providers/azure/key-update.sh"
}
