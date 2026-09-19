#!/usr/bin/env bash
# provider-core.bash - Provider abstraction core: detection, dispatch, auth and
# secret-store seams, capability flags, and the error contract.
#
# Design contract:
#   - Dispatch is by naming convention: domain code calls provider_<domain>_<verb>;
#     the active provider's module (sourced after this file) defines those
#     functions. Adding a provider means adding module files — provider-core
#     never changes. There is no registry.
#   - Detection is config-driven: the `[provider] name` key in devenv.config
#     (default: github).
#   - Auth seam: all credential handling goes through provider_auth_env /
#     provider_secret_get. Domain modules and scripts never read GH_TOKEN
#     directly, so the credential backing store swaps in behind these
#     functions without touching callers.
#   - Token resolution order: env-if-allowlisted → keychain (gh auth token)
#     → error. A session-scoped GH_TOKEN export is honored only when the
#     allowlist opts in (escape hatch); otherwise the seam warns and falls
#     through to the keychain.
#   - Capability flags: GH-only surfaces (rulesets, project boards, native
#     issue types) are declared capabilities. Callers gate with
#     provider_require_capability, which fails with a defined
#     "provider does not support this" error instead of failing mid-command.
#   - Error contract: library functions return non-zero and log via log_error;
#     provider-core never exits (github-helpers' `exit 1` is the recorded
#     anti-precedent). Exit decisions belong to scripts.
#
# Sourcing contract: callers set DEVENV_TOOLS (self-root contract), source
# this file, then source the active provider's domain modules from
# "${DEVENV_TOOLS}/lib/providers/${PROVIDER_NAME}/".

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

# Active provider name (set by provider_detect).
PROVIDER_NAME=""
export PROVIDER_NAME

# Escape-hatch allowlist for session-scoped GH_TOKEN exports (AC-2). Ships
# empty; entries are added via devenv.config [provider] token_env_allowlist
# and follow a justification-and-review protocol (see tools/lib/providers/
# README.md). Tokens outside the allowlist warn at consumer time and are
# ignored by the seam.
PROVIDER_TOKEN_ENV_ALLOWLIST="${PROVIDER_TOKEN_ENV_ALLOWLIST:-}"
export PROVIDER_TOKEN_ENV_ALLOWLIST

# Token source kinds, in resolution order.
PROVIDER_TOKEN_ENV="env"
PROVIDER_TOKEN_KEYCHAIN="keychain"

# Resolve the active provider from devenv.config [provider] name, defaulting
# to github. Sets PROVIDER_NAME (exported) so domain modules can be sourced
# from "${DEVENV_TOOLS}/lib/providers/${PROVIDER_NAME}/".
#
# Usage:
#   provider_detect                       # uses DEVENV_ROOT/devenv.config
#   provider_detect /path/to/devenv.config
#
# Returns:
#   0 on success; 1 if the config file exists but the value is empty.
provider_detect() {
    local config_file="${1:-}"

    if [ -z "$config_file" ]; then
        config_file="${DEVENV_ROOT:-}/devenv.config"
    fi

    local name=""
    if [ -f "$config_file" ]; then
        # Prefer config-reader when it is actually loadable; otherwise use the
        # minimal INI fallback. Availability is decided by loadability (guarded
        # source), not by an exported flag, so the fallback engages correctly
        # in stripped environments.
        name=""
        if [ -f "${DEVENV_TOOLS:-}/lib/config-reader.bash" ]; then
            # shellcheck disable=SC1091
            source "${DEVENV_TOOLS}/lib/config-reader.bash"
            config_init "$config_file" && name=$(config_read_value "provider" "name" "" 2>/dev/null)
        fi
        if [ -z "$name" ]; then
            # Minimal INI read: value in the [provider] section. Tolerates
            # comments, blank lines, and padded keys/values; first match wins.
            name=$(awk -F= '
                /^\[/ { in_provider = ($0 ~ /^\[provider\]/) ; next }
                in_provider && $1 ~ /^[ \t]*name[ \t]*$/ { v=$2; gsub(/^[ \t]+|[ \t]+$/, "", v); print v; exit }
            ' "$config_file")
        fi
    fi

    if [ -z "$name" ]; then
        name="github"
    fi

    PROVIDER_NAME="$name"
    export PROVIDER_NAME

    # Escape-hatch allowlist (AC-2): read [provider] token_env_allowlist when
    # a config file is available. A caller-provided export is preserved when
    # there is no config file or the key is absent (detection never widens
    # nor narrows an explicit caller decision); only an existing config file
    # is authoritative.
    if [ -f "$config_file" ]; then
        local allow=""
        if [ -f "${DEVENV_TOOLS:-}/lib/config-reader.bash" ]; then
            # shellcheck disable=SC1091
            source "${DEVENV_TOOLS}/lib/config-reader.bash"
            if config_init "$config_file"; then
                allow=$(config_read_value "provider" "token_env_allowlist" "" 2>/dev/null)
            fi
        fi
        if [ -z "$allow" ]; then
            # Same minimal INI fallback as the name key above.
            allow=$(awk -F= '
                /^\[/ { in_provider = ($0 ~ /^\[provider\]/) ; next }
                in_provider && $1 ~ /^[ \t]*token_env_allowlist[ \t]*$/ { v=$2; gsub(/^[ \t]+|[ \t]+$/, "", v); print v; exit }
            ' "$config_file")
        fi
        PROVIDER_TOKEN_ENV_ALLOWLIST="$allow"
    fi
    export PROVIDER_TOKEN_ENV_ALLOWLIST
    return 0
}

# Directory holding the active provider's domain modules.
#
# Usage:
#   source "$(provider_module_dir)/issues.bash"
#
# Returns:
#   Prints the module directory; returns 1 if detection has not run.
provider_module_dir() {
    if [ -z "$PROVIDER_NAME" ]; then
        log_error "provider_detect has not run — call it before sourcing modules"
        return 1
    fi
    echo "${DEVENV_TOOLS}/lib/providers/${PROVIDER_NAME}"
}

# Dispatch guard for a domain verb: verifies the active provider implements
# provider_<domain>_<verb>. Domain code calls this before first use of an
# optional verb, or relies on the module defining all inventory verbs.
#
# Usage:
#   provider_dispatch issues list || return 1
#
# Returns:
#   0 if the function provider_<domain>_<verb> exists; 1 otherwise (logged).
provider_dispatch() {
    local domain="$1"
    local verb="$2"
    if ! declare -F "provider_${domain}_${verb}" >/dev/null; then
        log_error "provider '${PROVIDER_NAME}' does not implement ${domain} ${verb} (provider_${domain}_${verb} is not defined)"
        return 1
    fi
    return 0
}

# ============================================================================
# Auth seam (AC-4)
# ============================================================================

# Escape-hatch allowlist entry: true when the token is allowlisted for
# session-scoped env use. Entries may be "values" or "value:reason" pairs;
# matching is on value prefix before the first colon.
provider_token_env_allowed() {
    local value="$1"
    local entry base
    # Intentional word-splitting: the allowlist is a space-separated entry list.
    # shellcheck disable=SC2086
    for entry in $PROVIDER_TOKEN_ENV_ALLOWLIST; do
        base="${entry%%:*}"
        [ "$value" = "$base" ] && return 0
    done
    return 1
}

# Warn that a session-scoped GH_TOKEN export is being ignored. Kept on stderr
# so stdout consumers (eval capture, emitted exports) are unaffected.
provider_token_env_denied_warning() {
    log_warn "GH_TOKEN is set but not on the env allowlist (config key [provider] token_env_allowlist) — ignored; resolving via keychain ('gh auth token'). Add an allowlist entry only with a documented justification."
}

# Resolve the token source kind in order: env-if-allowlisted → keychain →
# failure. Prints the kind; returns 1 when no source is available.
provider_token_kind() {
    if [ -n "${GH_TOKEN:-}" ]; then
        if provider_token_env_allowed "$GH_TOKEN"; then
            printf '%s\n' "$PROVIDER_TOKEN_ENV"
            return 0
        fi
        provider_token_env_denied_warning
    fi
    if command -v gh >/dev/null 2>&1; then
        if gh auth token >/dev/null 2>&1; then
            printf '%s\n' "$PROVIDER_TOKEN_KEYCHAIN"
            return 0
        fi
    fi
    return 1
}

# Emit the environment assignments domain modules need for gh auth, without
# exposing the token value. Resolution order: env-if-allowlisted → keychain
# (gh auth token) → error. The keychain branch emits no token export — gh
# resolves natively from its own credential store.
#
# Usage:
#   eval "$(provider_auth_env)"   # or inspect PROVIDER_AUTH_KIND
#
# Returns:
#   Prints export lines; returns 1 if no credential source is available.
provider_auth_env() {
    local kind
    kind=$(provider_token_kind) || {
        log_error "no credential source available (GH_TOKEN not allowlisted and keychain 'gh auth token' failed) — provider auth seam cannot resolve"
        return 1
    }
    case "$kind" in
        "$PROVIDER_TOKEN_ENV")
            # PROVIDER_AUTH_KIND is exported via the emitted script (not set
            # directly) because the emitted output may be captured through
            # command substitution, which runs the function in a subshell
            # where direct assignments would be lost.
            printf 'export GH_TOKEN=%q\n' "$GH_TOKEN"
            printf 'export PROVIDER_AUTH_KIND=%q\n' "$PROVIDER_TOKEN_ENV"
            return 0
            ;;
        "$PROVIDER_TOKEN_KEYCHAIN")
            # No token export: gh resolves natively from its credential store.
            # Emit `unset GH_TOKEN` so a leftover (ignored) env token cannot
            # outrank the keychain in child gh processes.
            printf 'unset GH_TOKEN\n'
            printf 'export PROVIDER_AUTH_KIND=%q\n' "$PROVIDER_TOKEN_KEYCHAIN"
            return 0
            ;;
    esac
    log_error "unknown token kind '$kind' resolved by the auth seam"
    return 1
}

# Read a named secret through the seam. Scope: single secret kind today
# ("token"); resolution follows the same order as provider_auth_env.
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
            if [ -n "${GH_TOKEN:-}" ] && provider_token_env_allowed "$GH_TOKEN"; then
                printf '%s\n' "$GH_TOKEN"
                return 0
            fi
            [ -n "${GH_TOKEN:-}" ] && provider_token_env_denied_warning
            if command -v gh >/dev/null 2>&1; then
                local tok
                if tok=$(gh auth token 2>/dev/null) && [ -n "$tok" ]; then
                    printf '%s\n' "$tok"
                    return 0
                fi
            fi
            log_error "secret 'token' unavailable via provider '${PROVIDER_NAME}' (env token not allowlisted and keychain 'gh auth token' failed)"
            return 1
            ;;
        *)
            log_error "unknown secret kind '$kind' for provider '${PROVIDER_NAME}'"
            return 1
            ;;
    esac
}

# ============================================================================
# Capability flags (AC-3)
# ============================================================================

# Capability registry for the active provider. Domain modules populate
# PROVIDER_CAPABILITIES at source time; core owns the query/gate helpers.
# Space-separated canonical capability names:
#   rulesets  project-boards  native-issue-types  releases  actions
PROVIDER_CAPABILITIES="${PROVIDER_CAPABILITIES:-}"

# Query a capability (read-only).
#
# Usage:
#   provider_has_capability rulesets && gh_only_thing
#
# Returns:
#   0 if declared; 1 if not (silent — use provider_require_capability to fail).
provider_has_capability() {
    local cap="$1"
    [[ " $PROVIDER_CAPABILITIES " == *" $cap "* ]]
}

# Defined degradation gate (AC-3): fail with the canonical
# "provider does not support this" error when the capability is absent.
# Returns non-zero; the caller (script) decides whether to exit.
#
# Usage:
#   provider_require_capability rulesets || exit 1
provider_require_capability() {
    local cap="$1"
    if provider_has_capability "$cap"; then
        return 0
    fi
    log_error "provider '${PROVIDER_NAME}' does not support capability '${cap}' — operation not available"
    return 1
}
