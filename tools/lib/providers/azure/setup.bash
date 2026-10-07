#!/usr/bin/env bash
# azure/setup.bash - Host-side provider hooks for the Azure DevOps provider.
#
# Sourced by `setup` on the user's own machine before the container exists, so
# this file must stay bash 3.2 compatible (macOS ships 3.2): no associative
# arrays, no ${var,,} case conversion, no mapfile. The container-side
# bootstrap.bash reuses these functions.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_AZURE_SETUP_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_AZURE_SETUP_LOADED=1

# Validate an Azure DevOps PAT read from stdin with one authenticated call to the
# organization's connectionData endpoint. The Authorization header travels on
# curl's stdin (-H @-), so the secret never appears in the process arguments.
# Azure answers an unauthenticated or bad-PAT request with 401 or with a 203
# sign-in page; only 200 counts as accepted.
#
# Usage: provider_setup_validate_token ORG < token
#
# Returns:
#   0 the organization accepted the token (HTTP 200)
#   1 the token was rejected, empty, or no organization was given
#   2 the service could not be reached (no HTTP status); the caller decides
#     whether an unverifiable token is acceptable (an offline user must not be trapped)
provider_setup_validate_token() {
    local org="${1:-}" token b64 http_code
    token="$(cat)"
    [ -n "$token" ] || return 1
    [ -n "$org" ] || return 1
    b64="$(printf ':%s' "$token" | base64 | tr -d '\r\n')"
    http_code=$(printf 'Authorization: Basic %s\n' "$b64" | curl -s -o /dev/null -w '%{http_code}' -H @- "https://dev.azure.com/${org}/_apis/connectionData?api-version=7.1-preview" 2>/dev/null)
    if [ -z "$http_code" ] || [ "$http_code" = "000" ]; then
        return 2
    fi
    [ "$http_code" = "200" ]
}

# --- Host-side prompting hooks -------------------------------------------------
# `setup` asks the provider what to say and what to accept; it names no provider.

# The provider's display name.
provider_setup_label() {
    echo "Azure DevOps"
}

# Instructions printed before the token prompt.
provider_setup_token_help() {
    echo "Create a PAT at: https://dev.azure.com/<organization>/_usersSettings/tokens"
    echo "Grant it the areas the tooling uses: Code, Work Items, Pull Request Threads,"
    echo "Build and Project and Team. See docs/Forking.md for detailed instructions."
}

# The token prompt text.
provider_setup_token_prompt() {
    echo "Paste your Azure DevOps PAT:"
}

# Azure PATs have no fixed prefix; the live check is the real validation.
provider_setup_check_token_format() {
    local token
    token="$(cat)"
    [ -n "$token" ]
}

# Print the organization named by the current repository's origin remote, if any:
#   https://dev.azure.com/ORG/PROJECT/_git/REPO
#   https://ORG@dev.azure.com/ORG/PROJECT/_git/REPO
#   git@ssh.dev.azure.com:v3/ORG/PROJECT/REPO
provider_setup_detect_org() {
    local url
    url="$(git remote get-url origin 2>/dev/null)" || return 0
    if [[ "$url" =~ ssh\.dev\.azure\.com:v3/([^/]+)/ ]]; then
        echo "${BASH_REMATCH[1]}"
    elif [[ "$url" =~ dev\.azure\.com/([^/]+)/ ]]; then
        echo "${BASH_REMATCH[1]}"
    fi
}

# Azure DevOps needs no host-side step beyond the token.
#
# Usage: provider_setup_post_hook SETUP_DIR
provider_setup_post_hook() {
    return 0
}
