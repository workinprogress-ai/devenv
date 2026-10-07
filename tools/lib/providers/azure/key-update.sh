#!/usr/bin/env bash
# key-update.sh (azure provider)
# Updates the Azure DevOps personal access token and reloads environment
# Usage: key-update-azure   (token on the prompt, or piped on stdin)

set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
# From lib/providers/<name>/, lib is three levels up.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/lib/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

# Source error handling library
source "$DEVENV_TOOLS/lib/error-handling.bash"

# Provider auth seam: the credential lifecycle (PAT file import) is the
# provider's job; this script lives in the azure provider folder and pins
# its provider explicitly.
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
export PROVIDER_NAME="azure"
provider_load auth

echo ">>> 🔐 Azure DevOps PAT Update Utility"
echo "    -------------------------------------------------------"
echo "    This will update your Azure DevOps personal access token"
echo "    (stored 0600 in the devenv config area)."
echo ""

# --help / -h must never be interpreted as a token.
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: key-update-azure | --help"
    echo ""
    echo "Rotate the Azure DevOps PAT used by the azure provider transport."
    echo "Prompts for the token on the terminal (hidden input); a piped stdin"
    echo "token also works: key-update-azure < token-file."
    echo "The token needs Work Items (Read/Write), Code (Read/Write), and"
    echo "Build (Read/Execute) scopes for the org's pipelines and repos."
    exit 0
fi

# The token is never an argument: it would sit on the process listing and in
# shell history.
if [ $# -gt 0 ]; then
    die "the token is not accepted as an argument (it would appear in the process list); paste it at the prompt or pipe it on stdin: key-update-azure < token-file" "$EXIT_MISUSE"
fi

# Get token from stdin (pipe or terminal prompt); capture EOF so an empty
# token reaches the validation below instead of set -e exiting on read's rc.
if [ ! -t 0 ]; then
    read -r NEW_TOKEN || NEW_TOKEN=""
else
    read -s -r -p "    Paste Azure DevOps personal access token: " NEW_TOKEN || NEW_TOKEN=""
    echo "" # Newline
    # Host literal sanctioned: user-facing pointer to this provider's token
    # page (the fork rewrites this script with its provider's URL).
    echo "    Create one at: https://dev.azure.com/{your-org}/_usersSettings/tokens"
fi

if [ -z "$NEW_TOKEN" ]; then
    die "No token provided. Operation cancelled." "$EXIT_MISUSE"
fi

# Azure PATs carry no recognizable prefix — format validation is limited to
# a length sanity check (Azure PATs are 52 chars).
if [ "${#NEW_TOKEN}" -lt 40 ]; then
    log_warn "Token is shorter than an Azure PAT typically is (${#NEW_TOKEN} chars). Proceeding anyway..."
fi

# 1. Rotate via the provider credential store — the single source of truth.
#    The token is never written to env-vars.sh or any backup file; the 0600
#    PAT file is the only durable copy.
echo "    - Rotating credentials (provider auth seam)..."
if ! provider_auth_import_token <<< "$NEW_TOKEN"; then
    die "credential import failed — token not accepted. No changes made."
fi

# 2. The provider verb wired the git credential helper during import.

echo "    ✅ Success! Credentials updated (0600 PAT file)."
echo "    -------------------------------------------------------"
echo "    The new token is now active for all Azure DevOps REST calls."
echo "    No token is stored in env files; the 0600 PAT file is the only"
echo "    durable credential copy."
echo ""
