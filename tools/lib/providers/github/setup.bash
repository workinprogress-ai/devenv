#!/usr/bin/env bash
# github/setup.bash - Host-side provider hooks for the GitHub provider.
#
# Sourced by `setup` on the user's own machine before the container exists, so
# this file must stay bash 3.2 compatible (macOS ships 3.2): no associative
# arrays, no ${var,,} case conversion, no mapfile. The container-side
# bootstrap.bash reuses these functions.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_GITHUB_SETUP_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_GITHUB_SETUP_LOADED=1

# Validate a GitHub token read from stdin against the API. The Authorization
# header travels on curl's stdin (-H @-), so the secret never appears in the
# process arguments.
#
# Usage: provider_setup_validate_token ORG < token     (ORG is unused on GitHub)
#
# Returns:
#   0 the API accepted the token (HTTP 200)
#   1 the token was rejected, or empty
#   2 the API could not be reached (no HTTP status); the caller decides whether
#     an unverifiable token is acceptable (an offline user must not be trapped)
provider_setup_validate_token() {
    local token http_code
    token="$(cat)"
    [ -n "$token" ] || return 1
    http_code=$(printf 'Authorization: Bearer %s\n' "$token" | curl -s -o /dev/null -w '%{http_code}' -H @- "https://api.github.com/user" 2>/dev/null)
    if [ -z "$http_code" ] || [ "$http_code" = "000" ]; then
        return 2
    fi
    [ "$http_code" = "200" ]
}

# --- Host-side prompting hooks -------------------------------------------------
# `setup` asks the provider what to say and what to accept; it names no provider.

# The provider's display name.
provider_setup_label() {
    echo "GitHub"
}

# Instructions printed before the token prompt.
provider_setup_token_help() {
    echo "Create a classic token at: https://github.com/settings/tokens/new"
    echo "Required scopes: repo, workflow, read:packages, read:org, write:discussion, project"
    echo "See the README for detailed instructions."
}

# The token prompt text.
provider_setup_token_prompt() {
    echo "Paste your GitHub PAT (starts with ghp_):"
}

# Check the shape of a token read from stdin before spending an API call on it.
# Prints the reason on stdout when the shape is wrong.
#
# Returns: 0 plausible, 1 wrong shape
provider_setup_check_token_format() {
    local token
    token="$(cat)"
    case "$token" in
        ghp_*) return 0 ;;
    esac
    echo "Token must start with ghp_. Please create a new token and paste it."
    return 1
}

# Print the organization named by the current repository's origin remote, if any.
# Reads the remote from the repository in the current directory.
provider_setup_detect_org() {
    local url
    url="$(git remote get-url origin 2>/dev/null)" || return 0
    if [[ "$url" =~ github\.com[:/]([^/]+)/ ]]; then
        echo "${BASH_REMATCH[1]}"
    fi
}

# Host-side steps that depend on the credential: GitHub's npm registry reads the
# token from ~/.npmrc, so seed it once when no auth token is configured yet.
#
# Usage: provider_setup_post_hook SETUP_DIR
provider_setup_post_hook() {
    local setup_dir="$1" token npmrc="$HOME/.npmrc"
    [ -s "$setup_dir/provider_token.txt" ] || return 0
    token="$(cat "$setup_dir/provider_token.txt")"
    if [ ! -f "$npmrc" ] || ! grep -q "_authToken" "$npmrc"; then
        echo "//npm.pkg.github.com/:_authToken=$token" >> "$npmrc"
        chmod 600 "$npmrc"
        echo ".npmrc configured for GitHub npm packages."
    fi
}
