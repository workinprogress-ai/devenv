#!/usr/bin/env bash
# azure/credential-helper.sh — git-credential helper backed by the 0600 PAT
# file (the same file provider_auth_import_token_impl writes).
#
# Speaks git's credential-helper protocol: git invokes
#   credential-helper.sh get   → helper prints protocol fields (username,
#                                password) for the queried host
#   credential-helper.sh store → no-op (the PAT file is the durable copy;
#                                git must never write a second one)
#   credential-helper.sh erase → no-op (rotation replaces the file wholesale)
#
# Installed by provider_auth_setup_git_impl as a host-scoped helper:
#   git config --global credential.https://dev.azure.com.helper \
#       '<absolute path> get'
# Host scoping is deliberate: github.com traffic never consults it.
#
# The path baked into git config is resolved at setup time
# (provider_auth_setup_git_impl passes "$(cd ... && pwd)"), so the helper
# survives across sessions without PATH dependence.

set -euo pipefail

# Locate the PAT file without sourcing the whole provider: same resolution
# as azure/auth.bash's azure_pat_file (HOME/.keys/azure-devops-pat; an
# AZURE_PAT_FILE override wins for tests).
AzureHelper_pat_file() {
    if [ -n "${AZURE_PAT_FILE:-}" ]; then
        printf '%s\n' "$AZURE_PAT_FILE"
        return
    fi
    printf '%s\n' "${HOME}/.keys/azure-devops-pat"
}

case "${1:-}" in
    get)
        pat_file="$(AzureHelper_pat_file)"
        if [ ! -f "$pat_file" ]; then
            echo "ERROR: azure PAT file not found: $pat_file (run key-update-azure)" >&2
            exit 1
        fi
        # Read the query git sends on stdin (protocol: key=value lines,
        # blank-line terminated) — consumed, not parsed: the helper answers
        # for any host-scoped query git routes here.
        cat > /dev/null
        pat="$(tr -d '\r\n' < "$pat_file")"
        if [ -z "$pat" ]; then
            echo "ERROR: azure PAT file is empty: $pat_file" >&2
            exit 1
        fi
        printf 'username=%s\n' "oauth"
        printf 'password=%s\n' "$pat"
        ;;
    store|erase)
        # Durable copy is the 0600 PAT file; git-side storage would create a
        # second plaintext copy — refused by doing nothing.
        cat > /dev/null
        exit 0
        ;;
    *)
        echo "usage: credential-helper.sh {get|store|erase}" >&2
        exit 1
        ;;
esac
