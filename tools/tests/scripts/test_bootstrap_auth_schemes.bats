#!/usr/bin/env bats
# Bootstrap authentication: provider-scheme headers and user npm configuration.
# Synthetic fixtures only, with no network or live credential access.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_ROOT="${BATS_TEST_DIRNAME}/../../.."
    NPMRC_SETUP=$(sed -n '/^configure_user_npmrc()/,/^}/p' "$DEVENV_ROOT/.devcontainer/bootstrap.bash")
    export NPMRC_SETUP
    export PROVIDER_NAME=github
    export STUB_NPM_TOKEN=synthetic-github-npm-token
}

teardown() {
    unset BUILDERS NPMRC_SETUP STUB_NPM_TOKEN
    test_helper_teardown
}

run_npmrc_setup() {
    run bash -c "
        provider=\"\$PROVIDER_NAME\"
        source \"$DEVENV_ROOT/tools/lib/providers/provider-core.bash\"
        PROVIDER_NAME=\"\$provider\"
        provider_load bootstrap 2>/dev/null
        $NPMRC_SETUP
        ensure_provider_seam() { :; }
        provider_secret_get() {
            printf 'lookup\n' >> \"\$HOME/token-lookups\"
            [ -n \"\${STUB_NPM_TOKEN:-}\" ] || return 1
            printf '%s' \"\$STUB_NPM_TOKEN\"
        }
        configure_user_npmrc
    "
}

git_header() {   # provider token
    bash -c "
        source '$DEVENV_ROOT/tools/lib/providers/provider-core.bash'
        PROVIDER_NAME=$1
        provider_load bootstrap 2>/dev/null
        provider_bootstrap_call git_auth_header '$2'
    "
}

@test "github scheme: x-access-token basic header" {
    run git_header github secret-token-1
    [ "$status" -eq 0 ]
    local expected
    expected=$(printf 'x-access-token:%s' "secret-token-1" | base64 -w0)
    [[ "$output" == "AUTHORIZATION: basic $expected" ]]
}

@test "azure scheme: RFC-7617 basic with empty user (':PAT')" {
    run git_header azure secret-token-1
    [ "$status" -eq 0 ]
    local expected
    expected=$(printf ':%s' "secret-token-1" | base64 -w0)
    [[ "$output" == "AUTHORIZATION: Basic $expected" ]]
}

@test "schemes differ for the same token (the dispatch is real)" {
    [ "$(git_header github secret-token-1)" != "$(git_header azure secret-token-1)" ]
}

@test "bootstrap.bash and the copilot-knowledge library name no provider for the git header" {
    run ! grep -nE '^[^#]*(azure\)|x-access-token)' "$DEVENV_ROOT/.devcontainer/bootstrap.bash" "$DEVENV_ROOT/tools/lib/copilot-knowledge.bash"
}

@test "npm setup: missing token prints status without creating invalid configuration" {
    export STUB_NPM_TOKEN=""
    run_npmrc_setup
    [ "$status" -eq 0 ]
    [[ "$output" == *"Skipping GitHub npm"* ]]
    [ ! -s "$HOME/.npmrc" ]
}

@test "npm setup: missing token preserves existing configuration" {
    export STUB_NPM_TOKEN=""
    printf 'registry=https://registry.npmjs.org/\n# existing preference\nfund=false\n' > "$HOME/.npmrc"
    cp "$HOME/.npmrc" "$TEST_TEMP_DIR/expected-npmrc"
    run_npmrc_setup
    [ "$status" -eq 0 ]
    cmp "$HOME/.npmrc" "$TEST_TEMP_DIR/expected-npmrc"
}

@test "npm setup: removes only the exact generated invalid message" {
    export PROVIDER_NAME=azure
    printf '%s\n' \
        'registry=https://registry.npmjs.org/' \
        'Skipping npmrc auth token (gh not authenticated)' \
        '# Skipping npmrc auth token (gh not authenticated)' \
        '//other.example.com/:_authToken=unrelated-synthetic-token' > "$HOME/.npmrc"
    printf '%s\n' \
        'registry=https://registry.npmjs.org/' \
        '# Skipping npmrc auth token (gh not authenticated)' \
        '//other.example.com/:_authToken=unrelated-synthetic-token' > "$TEST_TEMP_DIR/expected-npmrc"
    run_npmrc_setup
    [ "$status" -eq 0 ]
    cmp "$HOME/.npmrc" "$TEST_TEMP_DIR/expected-npmrc"
}

@test "npm setup: Azure never reads a token or creates a GitHub registry entry" {
    export PROVIDER_NAME=azure
    export STUB_NPM_TOKEN=synthetic-azure-pat
    run_npmrc_setup
    [ "$status" -eq 0 ]
    [ ! -e "$HOME/token-lookups" ]
    [ ! -s "$HOME/.npmrc" ]
    [[ "$output" != *"synthetic-azure-pat"* ]]
}

@test "npm setup: Azure preserves unrelated settings and unknown authentication entries" {
    export PROVIDER_NAME=azure
    printf '%s\n' 'fund=false' '//npm.pkg.github.com/:_authToken=existing-unknown-token' > "$HOME/.npmrc"
    cp "$HOME/.npmrc" "$TEST_TEMP_DIR/expected-npmrc"
    run_npmrc_setup
    [ "$status" -eq 0 ]
    cmp "$HOME/.npmrc" "$TEST_TEMP_DIR/expected-npmrc"
    [ ! -e "$HOME/token-lookups" ]
}

@test "npm setup: GitHub creates a private registry token file without logging credentials" {
    run_npmrc_setup
    [ "$status" -eq 0 ]
    [ "$(cat "$HOME/.npmrc")" = '//npm.pkg.github.com/:_authToken=synthetic-github-npm-token' ]
    [ "$(stat -c '%a' "$HOME/.npmrc")" = 600 ]
    [[ "$output" != *"synthetic-github-npm-token"* ]]
}

@test "npm setup: GitHub updates its token once and preserves unrelated lines" {
    printf '%s\n' \
        '# retain comment' \
        'registry=https://registry.npmjs.org/' \
        ' //npm.pkg.github.com/:_authToken = old-synthetic-token' \
        '//other.example.com/:_authToken=unrelated-synthetic-token' \
        '//npm.pkg.github.com/:_authToken=duplicate-old-token' > "$HOME/.npmrc"
    printf '%s\n' \
        '# retain comment' \
        'registry=https://registry.npmjs.org/' \
        '//npm.pkg.github.com/:_authToken=synthetic-github-npm-token' \
        '//other.example.com/:_authToken=unrelated-synthetic-token' > "$TEST_TEMP_DIR/expected-npmrc"
    run_npmrc_setup
    [ "$status" -eq 0 ]
    cmp "$HOME/.npmrc" "$TEST_TEMP_DIR/expected-npmrc"
    [[ "$output" != *"synthetic-github-npm-token"* ]]
}

@test "npm setup: repeated GitHub setup is stable" {
    printf 'fund=false\n' > "$HOME/.npmrc"
    run_npmrc_setup
    [ "$status" -eq 0 ]
    cp "$HOME/.npmrc" "$TEST_TEMP_DIR/expected-npmrc"
    run_npmrc_setup
    [ "$status" -eq 0 ]
    cmp "$HOME/.npmrc" "$TEST_TEMP_DIR/expected-npmrc"
    [ "$(grep -c '^//npm.pkg.github.com/:_authToken=' "$HOME/.npmrc")" -eq 1 ]
}

@test "npm setup: unknown provider never reads a GitHub token" {
    export PROVIDER_NAME=unknown
    run_npmrc_setup
    [ "$status" -eq 0 ]
    [ ! -e "$HOME/token-lookups" ]
    [ ! -s "$HOME/.npmrc" ]
}
