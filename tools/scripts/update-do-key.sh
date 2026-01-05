#!/usr/bin/env bash

################################################################################
# update-do-key.sh
#
# Update the Digital Ocean API token and reload environment
#
# Usage:
#   ./update-do-key.sh [TOKEN]
#
# Arguments:
#   TOKEN - Digital Ocean API token (optional, will be prompted if not provided)
#
# Description:
#   Updates your Digital Ocean API token in the environment configuration.
#   The token is stored persistently and made available to the current shell.
#
# Dependencies:
#   - error-handling.bash
#   - devenv-add-env-vars.sh
#
################################################################################

set -euo pipefail

# Source error handling library
source "$DEVENV_TOOLS/lib/error-handling.bash"

echo ">>> 🔐 Digital Ocean Token Update Utility"
echo "    -------------------------------------------------------"
echo "    This will update your Digital Ocean API token."
echo ""

# Get token from argument or prompt user
if [ -n "${1:-}" ]; then
    NEW_TOKEN="$1"
else
    read -s -p "    Paste Digital Ocean API token: " NEW_TOKEN
    echo "" # Newline
    echo "    Create one at: https://cloud.digitalocean.com/account/api/tokens"
fi

if [ -z "$NEW_TOKEN" ]; then
    error_exit "No token provided. Operation cancelled."
fi

# Validate token format (Digital Ocean tokens are long hex strings, typically 64 characters)
if [ ${#NEW_TOKEN} -lt 32 ]; then
    log_warn "Token appears to be shorter than expected. Digital Ocean tokens are typically long hex strings."
    log_warn "Proceeding anyway..."
fi

# 1. Update env-vars.sh (Persistence)
echo "    - Updating environment variables..."
"$DEVENV_TOOLS/devenv-add-env-vars.sh" "DO_TOKEN=$NEW_TOKEN"

# 2. Update token file in .setup folder
echo "    - Storing token in backup file..."
TOKEN_FILE="$DEVENV_ROOT/.setup/do_token.txt"
mkdir -p "$(dirname "$TOKEN_FILE")"
echo "$NEW_TOKEN" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

# 3. Export for current execution scope
export DO_TOKEN="$NEW_TOKEN"

# 4. Source the updated env-vars to reload in current shell context
if [ -f "$DEVENV_ROOT/.runtime/env-vars.sh" ]; then
    source "$DEVENV_ROOT/.runtime/env-vars.sh"
fi

echo "    ✅ Success! Digital Ocean token updated."
echo "    -------------------------------------------------------"
echo "    The new token is now active in your environment."
echo "    You can now continue working. No container restart required."
echo ""
