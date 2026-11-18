#!/usr/bin/env bash
# azure/credential-helper.sh — git-credential helper backed by the 0600 PAT
# file (the same file provider_auth_import_token_impl writes).
#
# Reads the token under the contract shared with http.ts and auth.bash: the
# AZURE_PAT env var first, else the 0600 PAT file.
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
#       "!'<absolute path>'"   (git appends the operation)
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

# Reduce raw token text on stdin to the token: first line only, trimmed of
# whitespace (CR included) and a leading byte-order mark — the same contract
# as http.ts azurePatGet and auth.bash.
AzureHelper_clean() {
    head -n1 | LC_ALL=C sed -e $'s/^\xEF\xBB\xBF//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

# Print the token under the shared contract: the AZURE_PAT env var first, else
# the PAT file (mode 600 only). Returns 1 with a message on stderr when there
# is no usable token.
AzureHelper_token() {
    local token
    token="$(printf '%s\n' "${AZURE_PAT:-}" | AzureHelper_clean)"
    if [ -n "$token" ]; then
        printf '%s\n' "$token"
        return 0
    fi
    local pat_file mode
    pat_file="$(AzureHelper_pat_file)"
    if [ ! -f "$pat_file" ]; then
        echo "ERROR: azure PAT file not found: $pat_file (run key-update-azure)" >&2
        return 1
    fi
    mode="$(stat -L -c '%a' "$pat_file" 2>/dev/null || stat -L -f '%Lp' "$pat_file" 2>/dev/null)"
    if [ "$mode" != "600" ]; then
        echo "ERROR: azure PAT file $pat_file has mode $mode (expected 600): chmod 600 $pat_file" >&2
        return 1
    fi
    token="$(AzureHelper_clean < "$pat_file")"
    if [ -z "$token" ]; then
        echo "ERROR: azure PAT file is empty: $pat_file" >&2
        return 1
    fi
    printf '%s\n' "$token"
}

case "${1:-}" in
    get)
        # Read the query git sends on stdin (protocol: key=value lines,
        # blank-line terminated) — consumed, not parsed: the helper answers
        # for any host-scoped query git routes here.
        cat > /dev/null
        pat="$(AzureHelper_token)" || exit 1
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
