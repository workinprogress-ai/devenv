#!/usr/bin/env bash
# update-github-token.sh
# Updates the GitHub personal access token and reloads environment
# Usage: update-github-token.sh [TOKEN]

set -euo pipefail

# Source error handling library
source "$DEVENV_ROOT/tools/lib/error-handling.bash"

echo ">>> 🔐 GitHub Token Update Utility"
echo "    -------------------------------------------------------"
echo "    This will update your GitHub personal access token."
echo ""

# Get token from argument or prompt user
if [ -n "${1:-}" ]; then
    NEW_TOKEN="$1"
else
    read -s -p "    Paste GitHub personal access token (classic) with repo scope: " NEW_TOKEN
    echo "" # Newline
    echo "    Create one at: https://github.com/settings/tokens"
fi

if [ -z "$NEW_TOKEN" ]; then
    error_exit "No token provided. Operation cancelled."
fi

# Validate token format (GitHub tokens typically start with ghp_)
if [[ ! "$NEW_TOKEN" =~ ^(gh|ghp_) ]]; then
    log_warn "Token doesn't start with expected prefix (ghp_ or gh_). Proceeding anyway..."
fi

# 1. Update env-vars.sh (Persistence)
echo "    - Updating environment variables..."
"$DEVENV_ROOT/scripts/devenv-add-env-vars.sh" "GH_TOKEN=$NEW_TOKEN"

# 2. Update token file in .setup folder
echo "    - Storing token in backup file..."
TOKEN_FILE="$DEVENV_ROOT/.setup/github_token.txt"
echo "$NEW_TOKEN" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

# 2. Export for current execution scope
export GH_TOKEN="$NEW_TOKEN"

# 3. Source the updated env-vars to reload in current shell context
if [ -f "$DEVENV_ROOT/.devcontainer/env-vars.sh" ]; then
    source "$DEVENV_ROOT/.devcontainer/env-vars.sh"
fi

echo "    ✅ Success! GitHub token updated."
echo "    -------------------------------------------------------"
echo "    The new token is now active in your environment."
echo "    You can now continue working. No container restart required."
echo ""
