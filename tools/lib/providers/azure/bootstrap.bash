#!/usr/bin/env bash
# azure/bootstrap.bash - Container-side bootstrap hooks for the Azure DevOps
# provider (the main bootstrap and the container-start pulls call these through
# provider_bootstrap_call).
#
# Hooks:
#   provider_bootstrap_validate_token < token       accepted(0) / rejected(1) / unreachable(2)
#   provider_bootstrap_git_auth_header TOKEN        http.extraheader value for git HTTPS

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

# The http.extraheader value for git HTTPS operations: RFC 7617 basic auth with an
# empty user and the PAT as the password (the same form the REST transport sends).
#
# Usage: provider_bootstrap_git_auth_header TOKEN
provider_bootstrap_git_auth_header() {
    local auth
    auth=$(printf ':%s' "$1" | base64 -w0)
    echo "AUTHORIZATION: Basic $auth"
}
