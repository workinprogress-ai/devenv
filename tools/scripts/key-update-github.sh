#!/usr/bin/env bash
# key-update-github.sh
# Updates the GitHub personal access token and reloads environment
# Usage: key-update-github.sh [TOKEN]

set -euo pipefail
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# Source error handling library
source "$DEVENV_TOOLS/lib/error-handling.bash"

echo ">>> 🔐 GitHub Token Update Utility"
echo "    -------------------------------------------------------"
echo "    This will update your GitHub personal access token."
echo ""

# Get token from argument or prompt user; capture EOF so an empty token
# reaches the validation below instead of set -e exiting on read's rc.
if [ -n "${1:-}" ]; then
    NEW_TOKEN="$1"
else
    read -s -r -p "    Paste GitHub personal access token (classic) with repo scope: " NEW_TOKEN || NEW_TOKEN=""
    echo "" # Newline
    echo "    Create one at: https://github.com/settings/tokens"
fi

if [ -z "$NEW_TOKEN" ]; then
    die "No token provided. Operation cancelled." "$EXIT_MISUSE"
fi

# Validate token format (GitHub tokens typically start with ghp_)
if [[ ! "$NEW_TOKEN" =~ ^(gh|ghp_) ]]; then
    log_warn "Token doesn't start with expected prefix (ghp_ or gh_). Proceeding anyway..."
fi

# 1. Update env-vars.sh (Persistence)
echo "    - Updating environment variables..."
"$DEVENV_TOOLS/devenv-add-env-vars" "GH_TOKEN=$NEW_TOKEN"

# 2. Update token file in .setup folder
echo "    - Storing token in backup file..."
TOKEN_FILE="$DEVENV_ROOT/.setup/github_token.txt"
echo "$NEW_TOKEN" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

# 2. Export for current execution scope
export GH_TOKEN="$NEW_TOKEN"

# 3. Source the updated env-vars to reload in current shell context
if [ -f "$DEVENV_ROOT/.runtime/env-vars.sh" ]; then
    source "$DEVENV_ROOT/.runtime/env-vars.sh"
fi

echo "    ✅ Success! GitHub token updated."
echo "    -------------------------------------------------------"
echo "    The new token is now active in your environment."
echo "    You can now continue working. No container restart required."
echo ""
