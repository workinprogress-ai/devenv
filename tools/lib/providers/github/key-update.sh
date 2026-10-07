#!/usr/bin/env bash
# key-update.sh (github provider)
# Updates the GitHub personal access token and reloads environment
# Usage: key-update-provider   (token on the prompt, or piped on stdin)

set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
# From lib/providers/<name>/, lib is three levels up.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/lib/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

# Source error handling library
source "$DEVENV_TOOLS/lib/error-handling.bash"

# Provider auth seam: the credential lifecycle (import + git helper wiring)
# is the provider's job, not this script's; loaded via the canonical loader.
# This script lives in the github provider folder and pins its provider — a
# fork on another backend uses its own provider's key-update.
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
export PROVIDER_NAME="github"
provider_load auth

echo ">>> 🔐 GitHub Token Update Utility"
echo "    -------------------------------------------------------"
echo "    This will update your GitHub personal access token."
echo ""

# --help / -h must never be interpreted as a token.
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: key-update-provider | --help"
    echo ""
    echo "Rotate the provider credential-store token used for git https auth."
    echo "Prompts for the token on the terminal (hidden input); a piped stdin"
    echo "token also works: key-update-provider < token-file."
    exit 0
fi

# The token is never an argument: it would sit on the process listing and in
# shell history.
if [ $# -gt 0 ]; then
    die "the token is not accepted as an argument (it would appear in the process list); paste it at the prompt or pipe it on stdin: key-update-provider < token-file" "$EXIT_MISUSE"
fi

# Get the token from stdin (pipe) or the terminal prompt; capture EOF so an
# empty token reaches the validation below instead of set -e exiting on read's rc.
if [ ! -t 0 ]; then
    read -r NEW_TOKEN || NEW_TOKEN=""
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
