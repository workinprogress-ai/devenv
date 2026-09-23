#!/usr/bin/env bash
# github/auth.bash - GitHub implementation of the credential lifecycle seam.
#
# Wraps gh's credential-store operations: login (token import), status, and
# the git credential-helper wiring. This module is the single sanctioned
# home for direct gh auth invocations (including the github.com host flags —
# host literals inside provider modules are per-provider by definition);
# everything else routes through the provider seam. Contract: return
# non-zero + log_error; never exit.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_GITHUB_AUTH_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_GITHUB_AUTH_LOADED=1

if ! declare -F log_error >/dev/null; then
    log_error() { echo "ERROR: $*" >&2; }
fi
if ! declare -F log_warn >/dev/null; then
    log_warn() { echo "WARN: $*" >&2; }
fi

if ! declare -F provider_dispatch >/dev/null; then
    log_error "github/auth.bash: provider-core must be sourced first"
    return 1
fi

# Import a token into gh's credential store and wire the git credential
# helper. Token is read from stdin (keeps it out of argv / process lists).
# Usage: provider_auth_import_token_impl < token
provider_auth_import_token_impl() {
    if ! gh auth login --with-token --hostname github.com --skip-ssh-key; then
        log_error "gh auth login failed — token not accepted"
        return 1
    fi
    if ! gh auth setup-git --hostname github.com >/dev/null 2>&1; then
        log_warn "gh auth setup-git failed — git pushes/pulls over https may fail until it is re-run"
    fi
    return 0
}

# Authenticated check (exit-code only; never emits the token).
# Usage: provider_auth_status_impl
provider_auth_status_impl() {
    gh auth status >/dev/null 2>&1
}

# Print the keychain token for the neutral core's auth seam. Single
# sanctioned home for the gh token read; provider-core delegates here so the
# resolution order (env-if-allowlisted → credential store) stays neutral.
# Usage: provider_auth_token_impl   (prints the token on stdout)
provider_auth_token_impl() {
    gh auth token
}
