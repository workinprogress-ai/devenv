#!/usr/bin/env bash
# provider-core.bash - The provider seam the container bootstrap chain sources:
# detection, the module loader, the hook dispatcher, the credential seam and the
# identity accessors. Everything else about a provider (issues, pull requests,
# repositories, capabilities, repo targeting) lives in the TypeScript layer; see
# tools/lib/providers/README.md ("Bash bootstrap surface") for who sources this
# file and which functions they call.
#
# Design contract:
#   - Detection is config-driven: the `[provider] name` key in devenv.config
#     (default: github). The TypeScript detection answers the same way; the
#     agreement is pinned by tools/tests/ts/provider-bash-agreement.test.ts.
#   - A provider is a directory beside this file holding its hook modules
#     (auth.bash, bootstrap.bash, setup.bash); adding a provider means adding
#     those files, provider-core never changes. There is no registry.
#   - Auth seam: credentials resolve through provider_secret_get and the
#     provider_auth_* lifecycle verbs, never from GH_TOKEN directly. A session
#     GH_TOKEN export is honored only when the allowlist opts in; otherwise the
#     seam warns and falls through to the provider credential store.
#   - Error contract: functions return non-zero and log via log_error;
#     provider-core never exits. Exit decisions belong to the caller.
#
# Sourcing contract: callers set DEVENV_TOOLS (self-root contract) and source
# this file, then load the active provider's modules with provider_load.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_CORE_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_CORE_LOADED=1

# Ensure logging is available (never exits; logging only)
if [ -z "${_ERROR_HANDLING_LOADED:-}" ] && [ -f "${DEVENV_TOOLS:-}/lib/error-handling.bash" ]; then
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/error-handling.bash"
fi
# Standalone-sourcing fallbacks (DEVENV_TOOLS not set): logging only.
if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi
if ! declare -F log_warn >/dev/null; then
    log_warn() { echo "WARN: $*" >&2; }
fi

# ============================================================================
# Detection & dispatch
# ============================================================================

# Active provider name (set by provider_detect). Default only when the
# caller has not already chosen: an exported PROVIDER_NAME (scripts and
# suites select azure explicitly) must survive sourcing this file.
PROVIDER_NAME="${PROVIDER_NAME:-}"
export PROVIDER_NAME

# Escape-hatch allowlist for session-scoped GH_TOKEN exports. Ships
# empty; entries are env-var names ("GH_TOKEN" or "GH_TOKEN:reason"), added via
# devenv.config [provider] token_env_allowlist
# and follow a justification-and-review protocol (see tools/lib/providers/
# README.md). Tokens outside the allowlist warn at consumer time and are
# ignored by the seam.
PROVIDER_TOKEN_ENV_ALLOWLIST="${PROVIDER_TOKEN_ENV_ALLOWLIST:-}"
export PROVIDER_TOKEN_ENV_ALLOWLIST

# Initialize the config reader's CONFIG_FILE for config_read_value callers, from
# the same file provider detection reads. An absent config stays unset (reads
# then fail defined).
declare -F config_get_raw >/dev/null || \
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config-reader.bash"
_cfg="${DEVENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/devenv.config"
[ -f "$_cfg" ] && config_init "$_cfg"
unset _cfg

# The one INI reader (lib/config-reader.bash, beside this lib's parent directory).
# Anchored on this file's own location, so it loads whatever DEVENV_TOOLS says.
_provider_config_reader() {
    declare -F config_get_raw >/dev/null && return 0
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config-reader.bash"
}

# Resolve the active provider from devenv.config [provider] name, defaulting to
# github when the name is absent. Sets PROVIDER_NAME (exported); provider_load
# sources the provider's modules from the directory of that name beside this file.
#
# Usage:
#   provider_detect                       # uses DEVENV_ROOT/devenv.config
#   provider_detect /path/to/devenv.config
#
# Returns:
#   0 on success; 1 when the configured name is not a shipped provider.
provider_detect() {
    local config_file="${1:-}"

    if [ -z "$config_file" ]; then
        if [ -n "$DEVENV_ROOT" ]; then
            config_file="$DEVENV_ROOT/devenv.config"
        else
            # No DEVENV_ROOT: resolve this checkout's own config (an empty
            # root would name /devenv.config, which never exists — the
            # detection would silently take the default-provider path even
            # on forks whose config sets a non-default provider).
            config_file="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/devenv.config"
        fi
    fi

    local name=""
    if [ -f "$config_file" ]; then
        _provider_config_reader
        name=$(config_get_raw "$config_file" "provider" "name" "")
    fi

    if [ -z "$name" ]; then
        name="github"
    else
        # A configured name must name a shipped provider — a typo must fail
        # at detection time (listing what shipped), not degrade to per-module
        # warnings and call-time errors. A shipped provider is a directory
        # beside this file that holds its bootstrap hooks; other directories
        # (the TypeScript facade) are not providers. Names compare exactly.
        local _providers_dir _entry _shipped="" _found=0
        _providers_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        for _entry in "$_providers_dir"/*/; do
            [ -f "${_entry}bootstrap.bash" ] || continue
            _entry="${_entry%/}"
            _entry="${_entry##*/}"
            _shipped="${_shipped:+$_shipped }$_entry"
            [ "$_entry" = "$name" ] && _found=1
        done
        if [ "$_found" -ne 1 ]; then
            log_error "provider_detect: provider '$name' is not shipped (available: ${_shipped:-none}) — check [provider] name in $config_file"
            PROVIDER_NAME=""
            return 1
        fi
    fi

    PROVIDER_NAME="$name"
    export PROVIDER_NAME

    # Escape-hatch allowlist: read [provider] token_env_allowlist when a config
    # file is available. A caller-provided export is preserved when there is no
    # config file; an existing config file is authoritative.
    if [ -f "$config_file" ]; then
        local allow=""
        allow=$(config_get_raw "$config_file" "provider" "token_env_allowlist" "")
        PROVIDER_TOKEN_ENV_ALLOWLIST="$allow"
    fi
    export PROVIDER_TOKEN_ENV_ALLOWLIST
    return 0
}

# The one canonical module loader: detect if needed, then source the named
# modules of the active provider. Best-effort by contract: a module file that
# does not exist is skipped with a warning, so a bare checkout carrying only this
# lib still loads (call sites fail defined), and an already-sourced module is a
# no-op (each module guards its own re-sourcing).
#
# Module paths anchor on this file's own location (the self-root contract:
# self-location wins), not on DEVENV_TOOLS — a caller may legitimately point
# DEVENV_TOOLS elsewhere (test isolation does exactly that) without moving
# the provider modules out from under the loader.
#
# Usage:
#   provider_load auth bootstrap          # source those modules
#   provider_load                          # detect only, no modules
#
# Returns:
#   0 when detection ran (or was already done); 1 when detection fails, with the
#   reason on stderr and the provider name left empty.
provider_load() {
    if [ -z "$PROVIDER_NAME" ]; then
        # Detection reports its own failure (an unshipped [provider] name, with the
        # names that are shipped); it is not silenced, and there is no fallback to
        # another provider: a typo must stop here, not become a call-time 127.
        provider_detect "${DEVENV_ROOT:-}/devenv.config" || return 1
    fi
    if [ -z "${_PROVIDER_CORE_MODULE_DIR:-}" ]; then
        _PROVIDER_CORE_MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        export _PROVIDER_CORE_MODULE_DIR
    fi
    local module_dir="${_PROVIDER_CORE_MODULE_DIR}/${PROVIDER_NAME}"
    local module
    for module in "$@"; do
        if [ -f "$module_dir/$module.bash" ]; then
            # shellcheck disable=SC1090
            source "$module_dir/$module.bash"
        else
            log_warn "provider_load: module '$module' not present for provider '$PROVIDER_NAME' — skipped (call sites must fail defined)"
        fi
    done
    return 0
}

# A provider verb the active provider does not define is a defined error, never
# bash's bare 127: under `set -e` a missing verb would otherwise end the script
# with "command not found" and no hint that the provider lacks it. Bash calls this
# for any command it cannot find; provider_* names get the provider-aware message
# and status 1, everything else keeps the standard failure.
command_not_found_handle() {
    case "$1" in
        provider_*)
            if declare -F log_error >/dev/null; then
                log_error "provider '${PROVIDER_NAME:-unset}' does not implement ${1#provider_} ($1 is not defined)"
            else
                echo "ERROR: provider '${PROVIDER_NAME:-unset}' does not implement ${1#provider_} ($1 is not defined)" >&2
            fi
            return 1
            ;;
        *)
            printf '%s: command not found\n' "$1" >&2
            return 127
            ;;
    esac
}

# Run a provider's bootstrap hook. The main bootstrap and the container-start
# pulls call hooks and never branch on the provider name: each provider's
# bootstrap.bash defines the hooks it implements; a hook the provider does not
# define is a no-op success. The hooks are listed in the "Bash bootstrap surface"
# section of providers/README.md.
#
# Usage:
#   provider_bootstrap_call HOOK [ARGS...]    # runs provider_bootstrap_<HOOK> ARGS...
#
# Returns:
#   the hook's status; 0 when the provider defines no such hook; 1 without a name.
provider_bootstrap_call() {
    local hook="${1:-}"
    if [ -z "$hook" ]; then
        log_error "provider_bootstrap_call requires a hook name"
        return 1
    fi
    shift
    if declare -F "provider_bootstrap_${hook}" >/dev/null; then
        "provider_bootstrap_${hook}" "$@"
    else
        return 0
    fi
}

# ============================================================================
# Auth seam
# ============================================================================

# Escape-hatch allowlist entry: true when the env variable NAME is allowlisted
# as a session-scoped token source. Entries are "NAME" or "NAME:reason" pairs;
# matching is on the name before the first colon. The list is never compared
# with a token's value.
provider_token_env_allowed() {
    local name="$1"
    local entry base
    # Intentional word-splitting: the allowlist is a space-separated entry list.
    # shellcheck disable=SC2086
    for entry in $PROVIDER_TOKEN_ENV_ALLOWLIST; do
        base="${entry%%:*}"
        [ "$name" = "$base" ] && return 0
    done
    return 1
}

# Warn that a session-scoped GH_TOKEN export is being ignored. Kept on stderr
# so stdout consumers (eval capture, emitted exports) are unaffected. The
# fallback wording is provider-neutral; the active provider's credential
# store decides what "keychain" concretely means.
provider_token_env_denied_warning() {
    log_warn "GH_TOKEN is set but not on the env allowlist (config key [provider] token_env_allowlist, which lists env-var names such as GH_TOKEN) — ignored; resolving via the ${PROVIDER_NAME:-active} provider credential store. Add an allowlist entry only with a documented justification."
}

# Read a named secret through the seam. Scope: single secret kind today
# ("token"); resolution is env-if-allowlisted, then the provider credential store.
#
# Usage:
#   token=$(provider_secret_get token) || exit
#
# Returns:
#   Prints the secret on stdout; returns 1 if the secret is unavailable.
#   Secrets are never logged.
provider_secret_get() {
    local kind="${1:-token}"
    case "$kind" in
        token)
            # GH_TOKEN is a GitHub credential: it is no token source under azure.
            if [ "${PROVIDER_NAME:-}" != "azure" ] && [ -n "${GH_TOKEN:-}" ]; then
                if provider_token_env_allowed "GH_TOKEN"; then
                    printf '%s\n' "$GH_TOKEN"
                    return 0
                fi
                provider_token_env_denied_warning
            fi
            if declare -F provider_auth_token_impl >/dev/null; then
                local tok
                if tok=$(provider_auth_token_impl 2>/dev/null) && [ -n "$tok" ]; then
                    printf '%s\n' "$tok"
                    return 0
                fi
            fi
            log_error "secret 'token' unavailable via provider '${PROVIDER_NAME}' (env token not allowlisted and the provider credential store has no token)"
            return 1
            ;;
        *)
            log_error "unknown secret kind '$kind' for provider '${PROVIDER_NAME}'"
            return 1
            ;;
    esac
}

# ============================================================================
# Credential lifecycle seam
# ============================================================================

# Import a credential into the provider's credential store, wiring whatever
# git-transport integration the provider requires. The single sanctioned
# place for a provider's credential CLI to be invoked; scripts and bootstrap
# never call it directly.
#
# Usage:
#   provider_auth_import_token <<< "$TOKEN"     # token on stdin
#
# Returns:
#   0 when the credential was stored and git integration wired; 1 otherwise.
provider_auth_import_token() {
    if [ -z "${PROVIDER_NAME:-}" ]; then
        log_error "provider_auth_import_token: provider_detect has not run"
        return 1
    fi
    # Guard on the _impl function, not this wrapper: a dispatch on auth
    # import_token would find this very function and always pass, so a
    # provider missing its auth module would crash on the missing impl
    # instead of failing with the defined error.
    if ! declare -F provider_auth_import_token_impl >/dev/null; then
        log_error "provider '${PROVIDER_NAME}' does not implement auth import_token (provider_auth_import_token_impl is not defined)"
        return 1
    fi
    provider_auth_import_token_impl
}

# Check whether the provider has a usable credential (exit-code only; no
# output, no stdout leakage). Gates scripts that require authentication
# without performing it.
#
# Usage:
#   provider_auth_status || { echo "not authenticated"; exit 1; }
#
# Returns:
#   0 when authenticated; 1 otherwise.
provider_auth_status() {
    if [ -z "${PROVIDER_NAME:-}" ]; then
        log_error "provider_auth_status: provider_detect has not run"
        return 1
    fi
    # Guard on the _impl function (same reason as import_token above).
    if ! declare -F provider_auth_status_impl >/dev/null; then
        log_error "provider '${PROVIDER_NAME}' does not implement auth status (provider_auth_status_impl is not defined)"
        return 1
    fi
    provider_auth_status_impl
}

# ============================================================================
# Identity accessors (org / user)
# ============================================================================

# Raw INI read for one section/key of DEVENV_ROOT/devenv.config. Reads RAW
# values only — no ${VAR} template expansion. Template expansion stays in
# config-reader, which resolves those templates against these accessors;
# expansion here would make the two mutually recurse.
#
# Returns:
#   Prints the raw value (possibly empty); 1 when the config file is absent.
_provider_identity_raw_read() {
    local section="$1"
    local key="$2"
    local config_file="${DEVENV_ROOT:-}/devenv.config"
    [ -f "$config_file" ] || return 1
    _provider_config_reader
    config_get_raw "$config_file" "$section" "$key" ""
}

# Resolve org identity: config [organization] org → seed file
# (.setup/provider_org.txt) → failure. No env var participates — devenv
# env vars carry no identity (GitHub is a provider like any other).
#
# Usage:
#   org=$(provider_org_get) || exit
#
# Returns:
#   Prints the org; returns 1 with a config-guided error when unresolvable.
provider_org_get() {
    local value
    value=$(_provider_identity_raw_read "organization" "org") && [ -n "$value" ] && {
        printf '%s\n' "$value"
        return 0
    }
    local seed_file="${DEVENV_ROOT:-}/.setup/provider_org.txt"
    if [ -f "$seed_file" ]; then
        value=$(tr -d '[:space:]' < "$seed_file")
        if [ -n "$value" ]; then
            printf '%s\n' "$value"
            return 0
        fi
    fi
    log_error "unable to resolve organization identity — set [organization] org in devenv.config (or run setup)"
    return 1
}

# Resolve user identity: config [organization] user → seed file
# (.setup/provider_user.txt) → failure. Same chain as provider_org_get.
#
# Usage:
#   user=$(provider_user_get) || exit
#
# Returns:
#   Prints the user; returns 1 with a config-guided error when unresolvable.
provider_user_get() {
    local value
    value=$(_provider_identity_raw_read "organization" "user") && [ -n "$value" ] && {
        printf '%s\n' "$value"
        return 0
    }
    local seed_file="${DEVENV_ROOT:-}/.setup/provider_user.txt"
    if [ -f "$seed_file" ]; then
        value=$(tr -d '[:space:]' < "$seed_file")
        if [ -n "$value" ]; then
            printf '%s\n' "$value"
            return 0
        fi
    fi
    log_error "unable to resolve user identity — set [organization] user in devenv.config (or run setup)"
    return 1
}
