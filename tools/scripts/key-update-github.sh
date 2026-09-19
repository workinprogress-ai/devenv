#!/usr/bin/env bash
# key-update-github.sh
# Updates the GitHub personal access token and reloads environment
# Usage: key-update-github.sh [TOKEN]

set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

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

# 1. Rotate via the GitHub CLI credential store (keychain) — the single
#    source of truth. The token is never written to env-vars.sh or any
#    backup file; git authentication flows through gh's credential helper.
echo "    - Rotating GitHub credentials (gh auth login)..."
if ! printf '%s' "$NEW_TOKEN" | gh auth login --with-token --hostname github.com --skip-ssh-key; then
    die "gh auth login failed — token not accepted by GitHub. No changes made."
fi

# 2. Keep gh's credential helper wired so clean remote URLs authenticate.
if ! gh auth setup-git --hostname github.com; then
    log_warn "gh auth setup-git failed — git pushes/pulls over https may fail until it is re-run"
fi

# No GH_TOKEN export: the keychain is the single auth source and env exports
# happen only through the provider seam's allowlist.

echo "    ✅ Success! GitHub token updated (gh credential store)."
echo "    -------------------------------------------------------"
echo "    The new token is now active. git https auth goes through"
echo "    gh's credential helper; no token is stored in env files."
echo ""
