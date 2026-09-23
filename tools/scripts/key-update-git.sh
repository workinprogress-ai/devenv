#!/usr/bin/env bash
# key-update-git.sh
# Updates the GitHub personal access token and reloads environment
# Usage: key-update-git.sh [TOKEN]

set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

# Source error handling library
source "$DEVENV_TOOLS/lib/error-handling.bash"

# Provider auth seam: the credential lifecycle (import + git helper wiring)
# is the provider's job, not this script's; loaded via the canonical loader.
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
provider_load auth

echo ">>> 🔐 GitHub Token Update Utility"
echo "    -------------------------------------------------------"
echo "    This will update your GitHub personal access token."
echo ""

# --help / -h must never be interpreted as a token: an unrecognized flag
# would otherwise fall through to the token path and fail at import.
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: key-update-git.sh [TOKEN] | --help"
    echo ""
    echo "Rotate the provider credential-store token used for git https auth."
    echo "With TOKEN: non-interactive rotation. Without: prompts on the terminal."
    exit 0
fi

# Get token from argument or prompt user; capture EOF so an empty token
# reaches the validation below instead of set -e exiting on read's rc.
if [ -n "${1:-}" ]; then
    NEW_TOKEN="$1"
else
    read -s -r -p "    Paste GitHub personal access token (classic) with repo scope: " NEW_TOKEN || NEW_TOKEN=""
    echo "" # Newline
    # Host literal sanctioned: user-facing pointer to this provider's token
    # page (the fork rewrites this script with its provider's URL).
    echo "    Create one at: https://github.com/settings/tokens"
fi

if [ -z "$NEW_TOKEN" ]; then
    die "No token provided. Operation cancelled." "$EXIT_MISUSE"
fi

# Validate token format (GitHub tokens typically start with ghp_)
if [[ ! "$NEW_TOKEN" =~ ^(gh|ghp_) ]]; then
    log_warn "Token doesn't start with expected prefix (ghp_ or gh_). Proceeding anyway..."
fi

# 1. Rotate via the provider credential store — the single source of truth.
#    The token is never written to env-vars.sh or any backup file; git
#    authentication flows through the provider's credential helper.
echo "    - Rotating credentials (provider auth seam)..."
if ! provider_auth_import_token <<< "$NEW_TOKEN"; then
    die "credential import failed — token not accepted. No changes made."
fi

# 2. The provider verb wired the git credential helper during import.
# No GH_TOKEN export: the credential store is the single auth source and env
# exports happen only through the provider seam's allowlist.

echo "    ✅ Success! Credentials updated (provider credential store)."
echo "    -------------------------------------------------------"
echo "    The new token is now active. git https auth goes through"
echo "    the provider credential helper; no token is stored in env files."
echo ""
