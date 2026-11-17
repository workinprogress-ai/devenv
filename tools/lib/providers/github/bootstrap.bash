#!/usr/bin/env bash
# github/bootstrap.bash - Container-side bootstrap hooks for the GitHub provider
# (the main bootstrap and the container-start pulls call these through
# provider_bootstrap_call).
#
# Hooks:
#   provider_bootstrap_validate_token < token       accepted(0) / rejected(1) / unreachable(2)
#   provider_bootstrap_git_auth_header TOKEN        http.extraheader value for git HTTPS

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
