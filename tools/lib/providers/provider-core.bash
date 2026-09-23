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
#   - Token resolution order: env-if-allowlisted → provider credential
#     store (the active provider's auth module) → error. A session-scoped GH_TOKEN export is honored only when the
#     allowlist opts in (escape hatch); otherwise the seam warns and falls
#     through to the keychain.
#   - Capability flags: GH-only surfaces (rulesets, project boards, native
#     issue types) are declared capabilities. Callers gate with
#     provider_require_capability, which fails with a defined
#     "provider does not support this" error instead of failing mid-command.
#   - Error contract: library functions return non-zero and log via log_error;
#     provider-core never exits (provider-loader's `exit 1` is the recorded
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
# The default-provider fallback is org policy: load the identity policy
# module (config-driven, POLICY_DEFAULT_PROVIDER overridable) once.
if ! declare -F policy_default_provider >/dev/null; then
    _policy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../policy" 2>/dev/null && pwd)"
    if [ -n "$_policy_dir" ] && [ -f "$_policy_dir/policy-core.bash" ]; then
        # shellcheck disable=SC1090,SC1091
        source "$_policy_dir/policy-core.bash"
        policy_core_init "${DEVENV_ROOT:-}/devenv.config" 2>/dev/null || true
        # shellcheck disable=SC1090,SC1091
        source "$_policy_dir/identity-policy.bash"
    fi
fi

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
                /^\[provider\]$/ { in_provider = 1; next }
                /^\[/ { in_provider = 0; next }
                in_provider && $1 ~ /^[ \t]*name[ \t]*$/ { v=$2; gsub(/^[ \t]+|[ \t]+$/, "", v); print v; exit }
            ' "$config_file")
        fi
    fi

    if [ -z "$name" ]; then
        # Default provider is org policy (fork-replaceable): resolve via the
        # policy layer, falling back to the historical value when the policy
        # layer itself cannot load (bootstrapping edge).
        name="$(policy_default_provider 2>/dev/null || echo github)"
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
                /^\[provider\]$/ { in_provider = 1; next }
                /^\[/ { in_provider = 0; next }
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

# The one canonical module loader: detect if needed, then source the named
# domain modules for the active provider. This replaces the per-lib guarded
# detect+source blocks (which drifted — one lib forgot auth.bash, and their
# hard-coded github fallbacks bypassed the policy layer). Best-effort by
# contract: a module file that does not exist is skipped with a warning, so
# a bare checkout carrying only this lib still loads (call sites fail
# defined), and an already-sourced module is a no-op (each module guards its
# own re-sourcing).
#
# Module paths anchor on this file's own location (the self-root contract:
# self-location wins), not on DEVENV_TOOLS — a caller may legitimately point
# DEVENV_TOOLS elsewhere (test isolation does exactly that) without moving
# the provider modules out from under the loader.
#
# Usage:
#   provider_load issues prs repos        # source those modules
#   provider_load                          # core only (detect + no modules)
#
# Returns:
#   0 when detection ran (or was already done); 1 when detection fails.
provider_load() {
    if [ -z "$PROVIDER_NAME" ]; then
        provider_detect "${DEVENV_ROOT:-}/devenv.config" 2>/dev/null
        if [ -z "$PROVIDER_NAME" ]; then
            # Policy-layer default with historical fallback for stripped
            # bootstrapping environments.
            PROVIDER_NAME="$(policy_default_provider 2>/dev/null || echo github)"
            export PROVIDER_NAME
        fi
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
# so stdout consumers (eval capture, emitted exports) are unaffected. The
# fallback wording is provider-neutral; the active provider's credential
# store decides what "keychain" concretely means.
provider_token_env_denied_warning() {
    log_warn "GH_TOKEN is set but not on the env allowlist (config key [provider] token_env_allowlist) — ignored; resolving via the ${PROVIDER_NAME:-active} provider credential store. Add an allowlist entry only with a documented justification."
}

# Whether the active provider offers a credential-store (keychain) token.
# Delegates to the provider module's provider_auth_token_impl — the neutral
# core owns the allowlist policy, never a concrete credential CLI.
# Returns 0 when a keychain token is available; 1 otherwise.
_provider_keychain_available() {
    declare -F provider_auth_token_impl >/dev/null || return 1
    provider_auth_token_impl >/dev/null 2>&1
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
    if _provider_keychain_available; then
        printf '%s\n' "$PROVIDER_TOKEN_KEYCHAIN"
        return 0
    fi
    return 1
}

# Emit the environment assignments domain modules need for auth, without
# exposing the token value. Resolution order: env-if-allowlisted → provider
# credential store → error. The keychain branch emits no token export —
# the provider CLI resolves natively from its own credential store.
#
# Usage:
#   eval "$(provider_auth_env)"   # or inspect PROVIDER_AUTH_KIND
#
# Returns:
#   Prints export lines; returns 1 if no credential source is available.
provider_auth_env() {
    local kind
    kind=$(provider_token_kind) || {
        log_error "no credential source available (GH_TOKEN not allowlisted and the ${PROVIDER_NAME:-active} provider credential store has no token) — provider auth seam cannot resolve"
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
            # No token export: the provider CLI resolves natively from its
            # own credential store.
            # Emit `unset GH_TOKEN` so a leftover (ignored) env token cannot
            # outrank the credential store in child provider-CLI processes.
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
# Capability flags (AC-3)
# ============================================================================

# Capability registry for the active provider. Domain modules declare at
# source time via provider_declare_capability (validation against the
# canonical list fails fast on typos); core owns the query/gate helpers.
# Canonical capability names:
#   rulesets  project-boards  native-issue-types  pipelines
# (releases is deliberately absent: portable across providers, ungated.)
PROVIDER_CAPABILITIES="${PROVIDER_CAPABILITIES:-}"

# Canonical capability names. A declare of anything else is a bug — fail at
# source time with a named error rather than silently answering false at
# query time.
PROVIDER_CAPABILITY_CANONICAL="rulesets project-boards native-issue-types pipelines"

# Declare one capability for the active provider.
# Usage: provider_declare_capability <name>
provider_declare_capability() {
    local cap="$1"
    case " $PROVIDER_CAPABILITY_CANONICAL " in
        *" $cap "*) ;;
        *)
            log_error "provider_declare_capability: '$cap' is not a canonical capability (${PROVIDER_CAPABILITY_CANONICAL})"
            return 1
            ;;
    esac
    case " $PROVIDER_CAPABILITIES " in
        *" $cap "*) ;;
        *) PROVIDER_CAPABILITIES="${PROVIDER_CAPABILITIES:+$PROVIDER_CAPABILITIES }$cap" ;;
    esac
}

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

# ============================================================================
# Credential lifecycle seam (#35/#36 follow-up)
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
    # Guard on the _impl function, not this wrapper: provider_dispatch auth
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

# Config file used by the identity accessors. Set via provider_identity_init;
# defaults to DEVENV_ROOT/devenv.config on first accessor use.
PROVIDER_IDENTITY_CONFIG=""

# Bind the identity accessors to a config file. Optional: accessors fall back
# to DEVENV_ROOT/devenv.config. provider_detect callers that pass an explicit
# config path should pass the same one here.
#
# Usage:
#   provider_identity_init /path/to/devenv.config
provider_identity_init() {
    PROVIDER_IDENTITY_CONFIG="${1:-${DEVENV_ROOT:-}/devenv.config}"
}

# Raw INI read for one section/key, mirroring provider_detect's layered
# strategy: config-reader when loadable, minimal awk fallback otherwise.
# Reads RAW values only — no ${VAR} template expansion. Template expansion
# stays in config-reader, which resolves those templates against these
# accessors; expansion here would make the two mutually recurse.
#
# Returns:
#   Prints the raw value (possibly empty); 0 when a config file exists.
_provider_identity_raw_read() {
    local section="$1"
    local key="$2"
    local config_file="${PROVIDER_IDENTITY_CONFIG:-${DEVENV_ROOT:-}/devenv.config}"
    [ -f "$config_file" ] || return 1
    local value=""
    if [ -f "${DEVENV_TOOLS:-}/lib/config-reader.bash" ]; then
        # shellcheck disable=SC1091
        source "${DEVENV_TOOLS}/lib/config-reader.bash"
        if config_init "$config_file" 2>/dev/null; then
            # Raw read: config_read_value would interpolate ${GH_ORG}/
            # ${GH_USER} templates, re-entering this accessor.
            value=$(config_read_value_raw "$section" "$key" "")
            printf '%s\n' "$value"
            return 0
        fi
    fi
    # Minimal INI fallback: same shape as provider_detect's name read.
    awk -F= -v section="$section" -v key="$key" '
        $0 ~ "^\\[" section "\\]" { in_section=1; next }
        /^\[/ { in_section=0; next }
        in_section && $1 ~ "^[ \\t]*" key "[ \\t]*$" { v=$2; gsub(/^[ \\t]+|[ \\t]+$/, "", v); print v; exit }
    ' "$config_file"
    return 0
}

# Resolve org identity: GH_ORG env override → config [organization]
# github_org → seed file (.setup/provider_org.txt) → failure. Env stays
# first so existing session exports keep working (compatibility override);
# config is the sanctioned source after bootstrap demotion.
#
# Usage:
#   org=$(provider_org_get) || exit
#
# Returns:
#   Prints the org; returns 1 with a config-guided error when unresolvable.
provider_org_get() {
    if [ -n "${GH_ORG:-}" ]; then
        printf '%s\n' "$GH_ORG"
        return 0
    fi
    local value
    # Config keys: neutral names first, GitHub-branded names as fallbacks
    # (existing configs keep working; the forking guide recommends neutral).
    for __key in org provider_org github_org; do
        value=$(_provider_identity_raw_read "organization" "$__key") && [ -n "$value" ] && {
            printf '%s\n' "$value"
            return 0
        }
    done
    unset __key
    local seed_file="${DEVENV_ROOT:-}/.setup/provider_org.txt"
    if [ -f "$seed_file" ]; then
        value=$(tr -d '[:space:]' < "$seed_file")
        if [ -n "$value" ]; then
            printf '%s\n' "$value"
            return 0
        fi
    fi
    log_error "unable to resolve organization identity — set [organization] github_org in devenv.config (or run setup); the GH_ORG env var is an optional override, not the source"
    return 1
}

# Resolve user identity: GH_USER env override → config [organization]
# github_user (optional key) → seed file (.setup/provider_user.txt) → failure.
# Same precedence rationale as provider_org_get.
#
# Usage:
#   user=$(provider_user_get) || exit
#
# Returns:
#   Prints the user; returns 1 with a config-guided error when unresolvable.
provider_user_get() {
    if [ -n "${GH_USER:-}" ]; then
        printf '%s\n' "$GH_USER"
        return 0
    fi
    local value
    for __key in user provider_user github_user; do
        value=$(_provider_identity_raw_read "organization" "$__key") && [ -n "$value" ] && {
            printf '%s\n' "$value"
            return 0
        }
    done
    unset __key
    local seed_file="${DEVENV_ROOT:-}/.setup/provider_user.txt"
    if [ -f "$seed_file" ]; then
        value=$(tr -d '[:space:]' < "$seed_file")
        if [ -n "$value" ]; then
            printf '%s\n' "$value"
            return 0
        fi
    fi
    log_error "unable to resolve user identity — set [organization] github_user in devenv.config (or run setup); the GH_USER env var is an optional override, not the source"
    return 1
}
