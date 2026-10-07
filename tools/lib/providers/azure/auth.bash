#!/bin/bash
# azure/auth.bash - Azure DevOps implementation of the credential lifecycle
# seam.
#
# Backing store is a 0600 PAT file in the devenv config area (no provider CLI
# exists for this transport — Azure is served by direct REST). A
# session-scoped GH_TOKEN export is honored only when allowlisted (the same
# [provider] token_env_allowlist the core seam enforces); there is no
# Azure-specific env override.
#
# Token discipline: the token is written from stdin (never argv), the file is
# created 0600, and every read verifies the mode is still 0600 before use.
# Contract: return non-zero + log_error; never exit.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_AZURE_AUTH_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_AZURE_AUTH_LOADED=1

if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi
if ! declare -F log_warn >/dev/null; then
    log_warn() { echo "WARN: $*" >&2; }
fi

if ! declare -F provider_load >/dev/null; then
    # Self-heal: source provider-core directly when loaded outside the
    # canonical loader (e.g. ad-hoc tooling that sources one module).
    # shellcheck disable=SC1091
    source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../provider-core.bash"
fi
if ! declare -F provider_load >/dev/null; then
    log_error "azure/auth.bash: providers/provider-core.bash failed to load"
    return 1
fi

# Path of the PAT file. Resolution order: AZURE_PAT_FILE override →
# devenv config area beside devenv.config.
azure_pat_file() {
    if [ -n "${AZURE_PAT_FILE:-}" ]; then
        printf '%s\n' "$AZURE_PAT_FILE"
        return 0
    fi
    # Credential files live OUTSIDE any repo tree: ~/.keys/ — a repo checkout
    # must never contain a secret, and DEVENV_ROOT is a repo path, so it
    # deliberately does not participate here.
    printf '%s\n' "${HOME}/.keys/azure-devops-pat"
}

# Import a token into the Azure PAT file. Token is read from stdin (keeps it
# out of argv / process lists). Creates the file 0600; tightens the mode on
# an existing file before writing.
# Usage: provider_auth_import_token_impl < token
provider_auth_import_token_impl() {
    local token
    token=$(cat)
    if [ -z "$token" ]; then
        log_error "empty token on stdin — nothing imported"
        return 1
    fi

    local pat_file
    pat_file=$(azure_pat_file)
    local pat_dir
    pat_dir=$(dirname "$pat_file")
    mkdir -p "$pat_dir"

    # Tighten first (existing-file case), then write, then verify.
    [ -f "$pat_file" ] && chmod 600 "$pat_file"
    if ! (umask 077 && printf '%s\n' "$token" > "$pat_file"); then
        log_error "failed writing PAT file: $pat_file"
        return 1
    fi
    chmod 600 "$pat_file"

    local mode
    mode=$(stat -c '%a' "$pat_file" 2>/dev/null || stat -f '%Lp' "$pat_file" 2>/dev/null)
    if [ "$mode" != "600" ]; then
        log_error "PAT file mode is $mode, expected 600 — refusing to keep it"
        return 1
    fi
    log_info "Azure DevOps PAT stored ($pat_file)"
    # Wire the git credential helper too, as the other provider's import does: git's global
    # config lives in the container home, so a recreated container needs it again.
    provider_auth_setup_git_impl || log_warn "git credential helper wiring failed — git pushes/pulls over https may fail until it is re-run"
    return 0
}

# Authenticated check: a resolvable token with sane file mode means the
# provider can operate. Never emits the token.
# Usage: provider_auth_status_impl
provider_auth_status_impl() {
    local token
    token=$(provider_auth_token_impl 2>/dev/null) || return 1
    [ -n "$token" ]
}

# Print the stored PAT for the neutral core's auth seam. Single sanctioned
# home for the Azure PAT read. The core seam resolves the allowlisted
# GH_TOKEN env leg before reaching this credential-store leg. Verifies the
# file mode before trusting the file.
# Usage: provider_auth_token_impl   (prints the token on stdout)
provider_auth_token_impl() {
    local pat_file
    pat_file=$(azure_pat_file)
    if [ ! -f "$pat_file" ]; then
        return 1
    fi
    local mode
    mode=$(stat -c '%a' "$pat_file" 2>/dev/null || stat -f '%Lp' "$pat_file" 2>/dev/null)
    if [ "$mode" != "600" ]; then
        log_warn "PAT file $pat_file has mode $mode (expected 600) — fix with: chmod 600 $pat_file"
        return 1
    fi
    local token
    token=$(head -n1 "$pat_file")
    printf '%s\n' "$token"
}

# Wire the PAT-backed credential helper for dev.azure.com and the
# <azure_org>.visualstudio.com host of the configured organization. HTTPS transport uses the 0600
# PAT file (never embedded URLs, never a second stored copy). Host-scoped:
# unrelated hosts never consult it. Re-running rewrites the same config lines.
# Usage: provider_auth_setup_git_impl
provider_auth_setup_git_impl() {
    local helper
    helper="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/credential-helper.sh"
    if [ ! -x "$helper" ]; then
        chmod +x "$helper" 2>/dev/null || true
    fi
    if ! git config --global "credential.https://dev.azure.com.helper" "$helper get"; then
        log_error "failed registering the azure credential helper in git config"
        return 1
    fi
    # The Azure organization ([provider] azure_org) is the one the API and the git
    # remotes use, so the visualstudio.com host derives from it, not from the
    # generic [organization] org.
    local org
    if ! org=$(config_read_value "provider" "azure_org" "" 2>/dev/null) || [ -z "$org" ]; then
        log_warn "organization identity unavailable; skipping visualstudio.com host credential helper"
        return 0
    fi
    org="${org,,}"
    if [[ ! "$org" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
        log_warn "invalid organization identity; skipping visualstudio.com host credential helper"
        return 0
    fi
    if ! git config --global "credential.https://${org}.visualstudio.com.helper" "$helper get"; then
        log_error "failed registering the visualstudio.com host credential helper in git config"
        return 1
    fi
    return 0
}
