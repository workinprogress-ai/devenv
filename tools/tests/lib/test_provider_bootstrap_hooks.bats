#!/usr/bin/env bats
# The per-provider bootstrap hook contract (tools/lib/providers/README.md): each
# provider ships bootstrap.bash (container side) and setup.bash (host side, called
# by `setup` before the container exists, so bash 3.2 only). The main bootstrap and
# `setup` call hooks and never branch on the provider name.

bats_require_minimum_version 1.5.0

load ../test_helper

PROVIDERS_DIR="$BATS_TEST_DIRNAME/../../lib/providers"

setup() {
    test_helper_setup
    mkdir -p "$TEST_TEMP_DIR/bin"
    export CURL_ARGV_LOG="$TEST_TEMP_DIR/curl-argv.log" CURL_STDIN_LOG="$TEST_TEMP_DIR/curl-stdin.log"
    : > "$CURL_ARGV_LOG"; : > "$CURL_STDIN_LOG"
    # curl stub: records argv and stdin (the header file), prints $FAKE_HTTP_CODE for -w
    cat > "$TEST_TEMP_DIR/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" >> "$CURL_ARGV_LOG"
cat >> "$CURL_STDIN_LOG"
printf '%s' "${FAKE_HTTP_CODE:-200}"
STUB
    chmod +x "$TEST_TEMP_DIR/bin/curl"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    export DEVENV_TOOLS="$BATS_TEST_DIRNAME/../.."
}

teardown() {
    test_helper_teardown
}

# ---------------------------------------------------------------------------
# provider_bootstrap_call: the one dispatch point
# ---------------------------------------------------------------------------

@test "provider_bootstrap_call runs a defined hook with its arguments and returns its status" {
    run bash -c '
        source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
        provider_bootstrap_demo() { echo "args: $*"; return 3; }
        provider_bootstrap_call demo a b
    '
    [ "$status" -eq 3 ]
    [[ "$output" == *"args: a b"* ]]
}

@test "provider_bootstrap_call is a no-op success for a hook the provider does not define" {
    run bash -c '
        source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
        provider_bootstrap_call no_such_hook x
    '
    [ "$status" -eq 0 ]
}

@test "provider_bootstrap_call requires a hook name" {
    run bash -c '
        source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
        provider_bootstrap_call
    '
    [ "$status" -ne 0 ]
}

# ---------------------------------------------------------------------------
# Every shipped provider implements the documented hooks
# ---------------------------------------------------------------------------

@test "github and azure ship bootstrap.bash and setup.bash" {
    for p in github azure; do
        [ -f "$PROVIDERS_DIR/$p/bootstrap.bash" ]
        [ -f "$PROVIDERS_DIR/$p/setup.bash" ]
    done
}

@test "provider_load bootstrap defines the container-side hooks for each provider" {
    for p in github azure; do
        run bash -c "
            source \"\$DEVENV_TOOLS/lib/providers/provider-core.bash\"
            PROVIDER_NAME=$p
            provider_load bootstrap
            for h in provider_bootstrap_validate_token provider_bootstrap_configure_nuget provider_bootstrap_configure_npmrc; do
                declare -F \"\$h\" >/dev/null || { echo \"$p is missing \$h\"; exit 1; }
            done
        "
        [ "$status" -eq 0 ] || { echo "$output"; false; }
    done
}

@test "provider_load setup defines the host-side validator for each provider" {
    for p in github azure; do
        run bash -c "
            source \"\$DEVENV_TOOLS/lib/providers/provider-core.bash\"
            PROVIDER_NAME=$p
            provider_load setup
            declare -F provider_setup_validate_token >/dev/null
        "
        [ "$status" -eq 0 ] || { echo "$p: $output"; false; }
    done
}

# ---------------------------------------------------------------------------
# setup.bash runs on the host (macOS bash 3.2): no bash 4+ features
# ---------------------------------------------------------------------------

bash4_features() {   # <file>: code lines (comments excluded) that use bash 4+ features
    grep -vE '^[[:space:]]*#' "$1" | grep -nE 'declare -A|local -n|declare -n|\$\{[A-Za-z_]+(,,|\^\^|@[QEPAa])\}|mapfile|readarray|&>>|;&|\|&|coproc|\[\[ -v '
}

@test "setup.bash files use no bash 4+ features (host bash may be 3.2)" {
    for p in github azure; do
        [ -f "$PROVIDERS_DIR/$p/setup.bash" ]
        run bash4_features "$PROVIDERS_DIR/$p/setup.bash"
        [ "$status" -ne 0 ] || { echo "bash 4+ feature in $p/setup.bash:"; echo "$output"; false; }
    done
}

@test "the bash 4+ guard is not vacuous: it flags associative arrays and case conversion" {
    printf 'declare -A m\necho "${x,,}"\n' > "$TEST_TEMP_DIR/bad.bash"
    run bash4_features "$TEST_TEMP_DIR/bad.bash"
    [ "$status" -eq 0 ]
    [[ "$output" == *"declare -A"* ]]
}

@test "setup.bash files parse under a strict POSIX-ish bash syntax check" {
    for p in github azure; do
        bash -n "$PROVIDERS_DIR/$p/setup.bash"
    done
}

# ---------------------------------------------------------------------------
# provider_setup_validate_token: accepted / rejected / unreachable
# ---------------------------------------------------------------------------

validate() {   # validate <provider> <org> <token> -> runs the host-side validator
    bash -c "
        source \"\$DEVENV_TOOLS/lib/providers/provider-core.bash\"
        PROVIDER_NAME=$1
        provider_load setup
        printf '%s' \"$3\" | provider_setup_validate_token \"$2\"
    "
}

@test "github validator: HTTP 200 accepts, 401 rejects (1), no status means unreachable (2)" {
    FAKE_HTTP_CODE=200 run validate github my-org tok-abc
    [ "$status" -eq 0 ]
    FAKE_HTTP_CODE=401 run validate github my-org tok-abc
    [ "$status" -eq 1 ]
    FAKE_HTTP_CODE=000 run validate github my-org tok-abc
    [ "$status" -eq 2 ]
}

@test "azure validator: HTTP 200 accepts, 401 and the 203 sign-in page reject (1), no status means unreachable (2)" {
    FAKE_HTTP_CODE=200 run validate azure my-org tok-abc
    [ "$status" -eq 0 ]
    FAKE_HTTP_CODE=401 run validate azure my-org tok-abc
    [ "$status" -eq 1 ]
    FAKE_HTTP_CODE=203 run validate azure my-org tok-abc
    [ "$status" -eq 1 ]
    FAKE_HTTP_CODE=000 run validate azure my-org tok-abc
    [ "$status" -eq 2 ]
}

@test "azure validator targets the org's connectionData endpoint and needs an org" {
    FAKE_HTTP_CODE=200 run validate azure my-org tok-abc
    grep -q "dev.azure.com/my-org/_apis/connectionData" "$CURL_ARGV_LOG"
    run validate azure "" tok-abc
    [ "$status" -ne 0 ]
}

@test "validators keep the token out of curl's arguments (the header rides stdin)" {
    FAKE_HTTP_CODE=200 run validate github my-org supersecret-token-1
    FAKE_HTTP_CODE=200 run validate azure my-org supersecret-token-2
    run grep -q "supersecret" "$CURL_ARGV_LOG"
    [ "$status" -ne 0 ]
    grep -q "Authorization: Bearer supersecret-token-1" "$CURL_STDIN_LOG"
    grep -q "Authorization: Basic " "$CURL_STDIN_LOG"
}

@test "validators reject an empty token without calling curl" {
    run validate github my-org ""
    [ "$status" -ne 0 ]
    run validate azure my-org ""
    [ "$status" -ne 0 ]
    [ ! -s "$CURL_ARGV_LOG" ]
}

# ---------------------------------------------------------------------------
# Container-side validation delegates to the host-side validator
# ---------------------------------------------------------------------------

@test "provider_bootstrap_validate_token delegates to provider_setup_validate_token" {
    for p in github azure; do
        FAKE_HTTP_CODE=401 run bash -c "
            source \"\$DEVENV_TOOLS/lib/providers/provider-core.bash\"
            PROVIDER_NAME=$p
            provider_load bootstrap
            config_read_value() { echo my-org; }
            printf tok | provider_bootstrap_validate_token
        "
        [ "$status" -eq 1 ] || { echo "$p: rc $status"; false; }
    done
}

@test "azure provider_bootstrap_validate_token validates against the configured azure_org" {
    FAKE_HTTP_CODE=200 run bash -c "
        source \"\$DEVENV_TOOLS/lib/providers/provider-core.bash\"
        PROVIDER_NAME=azure
        provider_load bootstrap
        config_read_value() { [ \"\$2\" = azure_org ] && echo the-azure-org; }
        printf tok | provider_bootstrap_validate_token
    "
    [ "$status" -eq 0 ]
    grep -q "dev.azure.com/the-azure-org/_apis/connectionData" "$CURL_ARGV_LOG"
}

# ---------------------------------------------------------------------------
# Azure registers only an Azure Artifacts [nuget] feed_url: no other host may see an Azure PAT
# ---------------------------------------------------------------------------

@test "azure package-feed hooks register nothing and say so without a configured feed" {
    run bash -c '
        source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
        PROVIDER_NAME=azure
        provider_load bootstrap
        config_read_value() { echo ""; }
        add_nuget_source_if_not_exists() { echo "UNEXPECTED nuget add: $*"; }
        provider_bootstrap_configure_nuget
        provider_bootstrap_configure_npmrc "$HOME/.npmrc"
    '
    [ "$status" -eq 0 ]
    [[ "$output" != *"UNEXPECTED"* ]]
    [[ "$output" == *"Skipping"* ]]
}

@test "azure configure_nuget registers the configured Azure Artifacts feed with the provider token" {
    run bash -c '
        source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
        PROVIDER_NAME=azure
        provider_load bootstrap
        config_read_value() { [ "$2" = feed_url ] && echo "https://pkgs.dev.azure.com/o/_packaging/f/nuget/v3/index.json"; }
        provider_secret_get() { echo "tok-123"; }
        add_nuget_source_if_not_exists() { echo "ADD: $1|$2|$3|$4"; }
        provider_bootstrap_configure_nuget
    '
    [ "$status" -eq 0 ]
    [[ "$output" == *"ADD: azure|https://pkgs.dev.azure.com/o/_packaging/f/nuget/v3/index.json|"*"|tok-123"* ]]
}

@test "azure configure_nuget skips without registering when the token is unavailable" {
    run bash -c '
        source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
        PROVIDER_NAME=azure
        provider_load bootstrap
        config_read_value() { [ "$2" = feed_url ] && echo "https://pkgs.dev.azure.com/o/_packaging/f/nuget/v3/index.json"; }
        provider_secret_get() { return 1; }
        add_nuget_source_if_not_exists() { echo "UNEXPECTED nuget add: $*"; }
        provider_bootstrap_configure_nuget
    '
    [ "$status" -eq 0 ]
    [[ "$output" != *"UNEXPECTED"* ]]
    [[ "$output" == *"Skipping"* ]]
}

@test "azure configure_nuget never sends the Azure token to a non-Azure feed_url" {
    run bash -c '
        source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
        PROVIDER_NAME=azure
        provider_load bootstrap
        config_read_value() { [ "$2" = feed_url ] && echo "https://nuget.pkg.github.com/some-org/index.json"; }
        provider_secret_get() { echo "tok-123"; }
        add_nuget_source_if_not_exists() { echo "UNEXPECTED nuget add: $*"; }
        provider_bootstrap_configure_nuget
    '
    [ "$status" -eq 0 ]
    [[ "$output" != *"UNEXPECTED"* ]]
    [[ "$output" == *"not an Azure Artifacts URL"* ]]
}

# ---------------------------------------------------------------------------
# Azure npm hook: [npm] feed_url registers an Azure Artifacts npm feed in the
# user-level npmrc (Microsoft-documented credential triple on both the
# .../npm/registry/ and .../npm/ prefixes). Credential safety: host allowlist
# before the secret is read; PAT never in output; file ends 0600.
# ---------------------------------------------------------------------------

# azure_npm_hook_run CONFIG_STDLIB... runs the hook with config_read_value
# answering from a section/key lookup and provider_secret_get from SECRET.
# Config is passed as "section:key=value" words.
azure_npm_hook_run() {
    run bash -c '
        cfg="$AZURE_NPM_CFG_FILE"
        source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
        PROVIDER_NAME=azure
        provider_load bootstrap
        config_read_value() {
            local section="$1" key="$2" line want
            want="$section:$key="
            while IFS= read -r line; do
                case "$line" in
                    "$want"*) printf "%s" "${line#"$want"}"; return 0 ;;
                esac
            done < "$cfg"
            return 1
        }
        provider_secret_get() { [ -n "$AZURE_NPM_SECRET" ] && printf "%s" "$AZURE_NPM_SECRET"; }
        provider_bootstrap_configure_npmrc "$AZURE_NPMRC"
    '
}

setup_azure_npm() {
    export AZURE_NPMRC="$TEST_TEMP_DIR/home/.npmrc"
    mkdir -p "$TEST_TEMP_DIR/home"
    export AZURE_NPM_CFG_FILE="$TEST_TEMP_DIR/cfg"
    export AZURE_NPM_SECRET="$1"; shift
    printf '%s\n' "$@" > "$AZURE_NPM_CFG_FILE"
}

@test "azure configure_npmrc writes the credential triple for both prefixes (scope set)" {
    setup_azure_npm "tok-123" "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/" "npm:scope=@acme"
    azure_npm_hook_run
    [ "$status" -eq 0 ]
    local p1="//pkgs.dev.azure.com/o/_packaging/f/npm/registry/" p2="//pkgs.dev.azure.com/o/_packaging/f/npm/"
    for p in "$p1" "$p2"; do
        grep -q "^$p:username=" "$AZURE_NPMRC"
        grep -q "^$p:_password=$(printf %s tok-123 | base64 -w0)$" "$AZURE_NPMRC"
        grep -q "^$p:email=" "$AZURE_NPMRC"
    done
    grep -q "^@acme:registry=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/$" "$AZURE_NPMRC"
}

@test "azure configure_npmrc omits the scope mapping when [npm] scope is empty" {
    setup_azure_npm "tok-123" "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/" "npm:scope="
    azure_npm_hook_run
    [ "$status" -eq 0 ]
    grep -q "^//pkgs.dev.azure.com/o/_packaging/f/npm/registry/:_password=" "$AZURE_NPMRC"
    ! grep -q ":registry=" "$AZURE_NPMRC"
}

@test "azure configure_npmrc skips a non-Azure feed_url and never reads the token" {
    setup_azure_npm "" "npm:feed_url=https://registry.npmjs.org/"
    azure_npm_hook_run
    [ "$status" -eq 0 ]
    [[ "$output" == *"not an Azure Artifacts URL"* ]]
    [ ! -e "$AZURE_NPMRC" ]
}

@test "azure configure_npmrc skips when no credential is available" {
    setup_azure_npm "" "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/"
    azure_npm_hook_run
    [ "$status" -eq 0 ]
    [[ "$output" == *"Skipping"* ]]
    [ ! -e "$AZURE_NPMRC" ]
}

@test "azure configure_npmrc skips with a message when [npm] feed_url is unset" {
    setup_azure_npm "tok-123" "npm:feed_url="
    azure_npm_hook_run
    [ "$status" -eq 0 ]
    [[ "$output" == *"Skipping"* ]]
    [ ! -e "$AZURE_NPMRC" ]
}

@test "azure configure_npmrc is idempotent: a second run converges to one entry set" {
    setup_azure_npm "tok-123" "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/" "npm:scope=@acme"
    azure_npm_hook_run
    [ "$status" -eq 0 ]
    azure_npm_hook_run
    [ "$status" -eq 0 ]
    [ "$(grep -c "^//pkgs.dev.azure.com/o/_packaging/f/npm/registry/:_password=" "$AZURE_NPMRC")" -eq 1 ]
    [ "$(grep -c "^//pkgs.dev.azure.com/o/_packaging/f/npm/:_password=" "$AZURE_NPMRC")" -eq 1 ]
    [ "$(grep -c "^@acme:registry=" "$AZURE_NPMRC")" -eq 1 ]
}

@test "azure configure_npmrc rotation: a new token replaces the stored password" {
    setup_azure_npm "old-token" "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/"
    azure_npm_hook_run
    AZURE_NPM_SECRET="fresh-token"
    azure_npm_hook_run
    [ "$status" -eq 0 ]
    grep -q "_password=$(printf %s fresh-token | base64 -w0)$" "$AZURE_NPMRC"
    ! grep -q "$(printf %s old-token | base64 -w0)" "$AZURE_NPMRC"
}

@test "azure configure_npmrc preserves unrelated lines" {
    setup_azure_npm "tok-123" "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/"
    printf 'registry=https://registry.npmjs.org/\n//other.registry/:_authToken=keepme\ninit-author-name=Someone\n' > "$AZURE_NPMRC"
    azure_npm_hook_run
    grep -q "^registry=https://registry.npmjs.org/$" "$AZURE_NPMRC"
    grep -q "^//other.registry/:_authToken=keepme$" "$AZURE_NPMRC"
    grep -q "^init-author-name=Someone$" "$AZURE_NPMRC"
}

@test "azure configure_npmrc leaves the file 0600 even when it was wider before" {
    setup_azure_npm "tok-123" "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/"
    printf 'init-author-name=Someone\n' > "$AZURE_NPMRC"
    chmod 644 "$AZURE_NPMRC"
    azure_npm_hook_run
    [ "$(stat -c %a "$AZURE_NPMRC")" = "600" ]
}

@test "azure configure_npmrc never prints the PAT" {
    setup_azure_npm "super-secret-pat-value" "npm:feed_url=https://pkgs.dev.azure.com/o/_packaging/f/npm/registry/"
    azure_npm_hook_run
    [[ "$output" != *"super-secret-pat-value"* ]]
}

# ---------------------------------------------------------------------------
# Rotation wiring: key-update must re-run the feed wiring hooks (npm + nuget)
# after a successful import, so a rotated PAT refreshes ~/.npmrc and the nuget
# source instead of leaving stale credentials behind.
# ---------------------------------------------------------------------------

@test "azure key-update re-runs the feed wiring hooks after a successful import" {
    # Interception happens in-process: source provider-core (arming its load
    # guard), override the two seams, then SOURCE the real key-update.sh —
    # its own provider-core source becomes a no-op, so the overrides survive.
    # Sourcing runs the script's main flow; the wiring calls land in the log.
    local wiring_log="$TEST_TEMP_DIR/keyupdate-wiring.log"
    run bash -c '
        source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
        PROVIDER_NAME=azure
        provider_load auth
        provider_auth_import_token() { return 0; }
        provider_bootstrap_call() {
            printf "%s %s\n" "$1" "${2:-}" >> "'"$TEST_TEMP_DIR"'/keyupdate-wiring.log"
            return 0
        }
        printf "tok-rotated-value\n" | source "$DEVENV_TOOLS/lib/providers/azure/key-update.sh"
    '
    [ "$status" -eq 0 ]
    grep -q "^configure_npmrc " "$wiring_log"
    grep -q "^configure_nuget" "$wiring_log"
}
