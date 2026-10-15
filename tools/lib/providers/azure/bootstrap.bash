#!/usr/bin/env bash
# azure/bootstrap.bash - Container-side bootstrap hooks for the Azure DevOps
# provider (the main bootstrap calls these through provider_bootstrap_call).
#
# Hooks:
#   provider_bootstrap_validate_token < token       accepted(0) / rejected(1) / unreachable(2)
#   provider_bootstrap_apt_packages                 space-separated OS packages the provider needs
#   provider_bootstrap_git_auth_header TOKEN        http.extraheader value for git HTTPS
#   provider_bootstrap_configure_nuget              package-feed registration
#   provider_bootstrap_configure_npmrc FILE         npm registry authentication
#

# Guard against multiple sourcing
if [ -n "${_PROVIDER_AZURE_BOOTSTRAP_LOADED:-}" ]; then
    return 0
fi
_PROVIDER_AZURE_BOOTSTRAP_LOADED=1

# shellcheck source=setup.bash
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/setup.bash"

# The organization is [provider] azure_org: the one the API and the git remotes use.
provider_bootstrap_validate_token() {
    local org
    org="$(config_read_value "provider" "azure_org" "" 2>/dev/null)" || org=""
    provider_setup_validate_token "$org"
}

# Azure DevOps needs no OS package beyond the base set.
provider_bootstrap_apt_packages() {
    return 0
}

# The http.extraheader value for git HTTPS operations: RFC 7617 basic auth with an
# empty user and the PAT as the password (the same form the REST transport sends).
#
# Usage: provider_bootstrap_git_auth_header TOKEN
provider_bootstrap_git_auth_header() {
    local auth
    auth=$(printf ':%s' "$1" | base64 -w0)
    echo "AUTHORIZATION: Basic $auth"
}

# Register the feed named by [nuget] feed_url with the provider credential, but only
# when it is an Azure Artifacts URL: the Azure PAT must never reach another host.
# Azure ignores the NuGet username, so a fixed one is used.
provider_bootstrap_configure_nuget() {
    local feed_url token
    feed_url=$(config_read_value "nuget" "feed_url" "")
    case "$feed_url" in
        https://pkgs.dev.azure.com/* | https://*.pkgs.visualstudio.com/*) ;;
        "")
            echo "Skipping NuGet feed registration (azure provider: [nuget] feed_url not configured)"
            return 0
            ;;
        *)
            echo "Skipping NuGet feed registration (azure provider: [nuget] feed_url is not an Azure Artifacts URL)"
            return 0
            ;;
    esac
    token=$(provider_secret_get token 2>/dev/null) || token=""
    if [ -z "$token" ]; then
        echo "Skipping NuGet feed registration (azure provider: credentials unavailable)"
        return 0
    fi
    add_nuget_source_if_not_exists "azure" "$feed_url" "azure" "$token"
}

# Register the Azure Artifacts npm feed in the user-level npmrc with the
# provider PAT. Microsoft's documented credential form (user-level npmrc):
#   //host/path/:username=<any non-empty value>
#   //host/path/:_password=<base64-encoded PAT>
#   //host/path/:email=<any value, required by npm but unused>
# Credentials are written for both the feed's own prefix and its sibling
# .../npm/ prefix when feed_url ends in /npm/registry/ (Microsoft's snippet
# writes both; single-prefix credentials are a known 401 source). The scope
# mapping rides along when [npm] scope is set. Unrelated lines are preserved;
# re-runs converge to one entry set per prefix; the file ends 0600.
#
# Usage: provider_bootstrap_configure_npmrc FILE
provider_bootstrap_configure_npmrc() {
    local npmrc_file="${1:?npmrc path required}"
    local feed_url scope token
    feed_url=$(config_read_value "npm" "feed_url" "")
    case "$feed_url" in
        https://pkgs.dev.azure.com/* | https://*.pkgs.visualstudio.com/*) ;;
        "")
            echo "Skipping npm registry authentication (azure provider: [npm] feed_url not configured)"
            return 0
            ;;
        *)
            echo "Skipping npm registry authentication (azure provider: [npm] feed_url is not an Azure Artifacts URL)"
            return 0
            ;;
    esac
    scope=$(config_read_value "npm" "scope" "")
    token=$(provider_secret_get token 2>/dev/null) || token=""
    if [ -z "$token" ]; then
        echo "Skipping npm registry authentication (azure provider: credentials unavailable)"
        return 0
    fi

    # Registry prefixes are host+path without the scheme (npmrc form). A
    # .../npm/registry/ feed also serves .../npm/: write both, deduplicated.
    local prefixes=() prefix
    prefix="${feed_url#https://}"
    prefix="${prefix%/}"
    prefixes+=("$prefix")
    if [[ "$prefix" == */npm/registry ]]; then
        prefixes+=("${prefix%/registry}")
    fi

    # The PAT is base64-encoded up front (npmrc _password form); the raw
    # token is handed to awk only through the environment, never the program
    # text, and the encoded form is what lands in the file.
    local token_b64
    token_b64=$(printf '%s' "$token" | base64 -w0)
    NPM_B64="$token_b64" NPM_SCOPE="$scope" awk -v prefixes="${prefixes[*]}" '
        BEGIN {
            n = split(prefixes, pfx, " ")
            b64 = ENVIRON["NPM_B64"]
            scope = ENVIRON["NPM_SCOPE"]
        }
        # Replace-or-keep: drop existing lines for our prefixes (and the scope
        # mapping) so the append at END converges instead of duplicating.
        !/^[[:space:]]*@[^:]+:registry=/ {
            keep = 1
            for (i = 1; i <= n; i++)
                if (index($0, "//" pfx[i] "/:") == 1) { keep = 0; break }
            if (keep) print
            next
        }
        scope != "" && /^[[:space:]]*@[^:]+:registry=/ { next }
        { print }
        END {
            for (i = 1; i <= n; i++) {
                printf "//%s/:username=notempty\n", pfx[i]
                printf "//%s/:_password=%s\n", pfx[i], b64
                printf "//%s/:email=npm-requires-email@example.invalid\n", pfx[i]
            }
            if (scope != "")
                printf "%s:registry=https://%s/\n", scope, pfx[1]
        }
    ' "$( [ -f "$npmrc_file" ] && printf '%s' "$npmrc_file" || printf '/dev/null' )" \
        > "${npmrc_file}.tmp" || {
        rm -f "${npmrc_file}.tmp"
        return 1
    }
    mv "${npmrc_file}.tmp" "${npmrc_file}" && chmod 600 "${npmrc_file}"
}
