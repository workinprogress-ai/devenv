#!/usr/bin/env bash
# github/bootstrap.bash - Container-side bootstrap hooks for the GitHub provider
# (the main bootstrap calls these through provider_bootstrap_call).
#
# Hooks:
#   provider_bootstrap_validate_token < token       accepted(0) / rejected(1) / unreachable(2)
#   provider_bootstrap_apt_packages                 space-separated OS packages the provider needs
#   provider_bootstrap_git_auth_header TOKEN        http.extraheader value for git HTTPS
#   provider_bootstrap_configure_nuget              register the GitHub Packages NuGet feed
#   provider_bootstrap_configure_npmrc FILE         authenticate the npm.pkg.github.com registry
#
# Environment the hooks rely on (provided by the main bootstrap): the provider seam
# (provider_secret_get, provider_org_get, provider_user_get), config_read_value, and
# for NuGet the add_nuget_source_if_not_exists helper.

# Guard against multiple sourcing
if [ -n "${_PROVIDER_GITHUB_BOOTSTRAP_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_GITHUB_BOOTSTRAP_LOADED=1

# shellcheck source=setup.bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/setup.bash"

provider_bootstrap_validate_token() {
    provider_setup_validate_token ""
}

# OS packages the provider's tooling needs: the GitHub CLI.
provider_bootstrap_apt_packages() {
    echo "gh"
}

# The http.extraheader value for git HTTPS operations (fetch, pull, clone): basic
# auth with the x-access-token user. The header rides git's argv, so it is briefly
# visible to local container users; it lives only for the fetch.
#
# Usage: provider_bootstrap_git_auth_header TOKEN
provider_bootstrap_git_auth_header() {
    local auth
    auth=$(printf 'x-access-token:%s' "$1" | base64 -w0)
    echo "AUTHORIZATION: basic $auth"
}

# Register the GitHub Packages NuGet feed (the feed URL comes from [nuget] feed_url,
# or the NUGET_FEED_URL override) with the provider credential.
provider_bootstrap_configure_nuget() {
    local feed_url="${NUGET_FEED_URL:-}" feed_org feed_user token
    if [ -z "$feed_url" ]; then
        feed_url=$(config_read_value "nuget" "feed_url" "")
    fi
    # Identity for the feed URL and the source registration comes from the
    # provider accessors (config, then seed); config_read_value has already
    # expanded the ${PROVIDER_ORG}/${PROVIDER_USER} templates in a configured URL.
    feed_org=$(provider_org_get 2>/dev/null) || feed_org=""
    feed_user=$(provider_user_get 2>/dev/null) || feed_user=""
    # A URL that came from the NUGET_FEED_URL override has not been expanded.
    feed_url="${feed_url//\$\{PROVIDER_ORG\}/$feed_org}"
    feed_url="${feed_url//\$\{PROVIDER_USER\}/$feed_user}"

    token=$(provider_secret_get token 2>/dev/null) || token=""
    if [ -n "$token" ] && [ -n "$feed_user" ] && [ -n "$feed_org" ] && [ -n "$feed_url" ]; then
        add_nuget_source_if_not_exists "github" "$feed_url" "$feed_user" "$token"
    else
        echo "Skipping GitHub NuGet feed: org/user identity, credentials, or feed_url not fully configured"
    fi
}

# Write the registry auth token into the given npmrc (created when missing).
provider_bootstrap_configure_npmrc() {
    local npmrc_file="${1:?npmrc path required}" token=""
    token=$(provider_secret_get token 2>/dev/null) || token=""
    if [ -z "$token" ]; then
        echo "Skipping GitHub npm registry authentication (credentials unavailable)"
        return 0
    fi
    local temporary_file
    # mktemp creates the file 0600, and the rename below carries that mode
    # over: the npmrc ends up owner-only even if it was wider before.
    temporary_file=$(mktemp "${npmrc_file}.XXXXXX") || return 1
    local input_file="$npmrc_file"
    [ -f "$input_file" ] || input_file=/dev/null
    if ! NPM_AUTH_TOKEN="$token" awk '
        BEGIN { token = ENVIRON["NPM_AUTH_TOKEN"] }
        token != "" && /^[[:space:]]*\/\/npm[.]pkg[.]github[.]com\/:_authToken[[:space:]]*=/ {
            if (!written) {
                printf "//npm.pkg.github.com/:_authToken=%s\n", token
                written = 1
            }
            next
        }
        { print }
        END {
            if (token != "" && !written)
                printf "//npm.pkg.github.com/:_authToken=%s\n", token
        }
    ' "$input_file" > "$temporary_file"; then
        rm -f "$temporary_file"
        return 1
    fi
    if ! mv "$temporary_file" "$npmrc_file"; then
        rm -f "$temporary_file"
        return 1
    fi
}
