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

provider_bootstrap_configure_npmrc() {
    echo "Skipping npm registry authentication (azure provider: no package feed configured)"
    return 0
}
