#!/usr/bin/env bash
# update-tailscale.sh
# Updates the Tailscale auth key and re-authenticates the daemon
# Usage: update-tailscale.sh

set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

# Source error handling library
source "$DEVENV_TOOLS/lib/error-handling.bash"

# Detect current hostname from running Tailscale config, or fallback to system hostname
CURRENT_HOSTNAME=$(tailscale status --json 2>/dev/null | grep -o '"HostName": "[^"]*"' | cut -d'"' -f4 || true)
if [ -z "$CURRENT_HOSTNAME" ]; then
    CURRENT_HOSTNAME="devbox-${HOSTNAME}"
fi

echo ">>> 🔄 Tailscale Key Update Utility"
echo "    Current hostname: $CURRENT_HOSTNAME"
echo "    -------------------------------------------------------"
echo "    This will update your Auth Key and immediately reconnect."
echo ""

# --help / -h must never be interpreted as a key: an unrecognized flag
# would otherwise fall through to the key path and fail at auth.
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: key-update-tailscale.sh [AUTH_KEY] | --help"
    echo ""
    echo "Rotate the Tailscale Reusable Auth Key and reconnect the node."
    echo "With AUTH_KEY: non-interactive. Without: prompts on the terminal."
    exit 0
fi

# 1. Capture New Key; capture EOF so an empty key reaches the validation
# below instead of set -e exiting on read's rc.
read -s -r -p "    Paste new Reusable Auth Key: " NEW_KEY || NEW_KEY=""
echo "" # Newline

if [ -z "$NEW_KEY" ]; then
    die "No key provided. Operation cancelled." "$EXIT_MISUSE"
fi

# Validate key format (should start with tskey-)
if [[ ! "$NEW_KEY" =~ ^tskey- ]]; then
    die "Invalid key format. Tailscale auth keys start with 'tskey-'" "$EXIT_MISUSE"
fi

# 2. Update env-vars.sh (Persistence)
echo "    - Updating environment variables..."
"$DEVENV_TOOLS/devenv-add-env-vars.sh" "TS_AUTHKEY=$NEW_KEY"

# 3. Export for current execution scope
export TS_AUTHKEY="$NEW_KEY"

# 4. Source the updated env-vars to reload in current shell context
if [ -f "$DEVENV_ROOT/.runtime/env-vars.sh" ]; then
    source "$DEVENV_ROOT/.runtime/env-vars.sh"
fi

# 5. Re-authenticate Daemon (Immediate Effect)
echo "    - Re-authenticating Tailscale daemon..."

# Force re-auth. The daemon does NOT need a restart.
if sudo tailscale up --authkey="$NEW_KEY" --hostname="$CURRENT_HOSTNAME" --accept-routes --reset; then
    echo "    ✅ Success! Tailscale is re-connected."
    echo "    -------------------------------------------------------"
    echo "    Hostname: $CURRENT_HOSTNAME"
    echo "    Status:"
    tailscale status | head -n 5
    echo ""
    echo "    You can now continue working. No container restart required."
else
    die "Failed to authenticate. Please check if the key is valid and not expired." "$EXIT_API_FAILURE"
fi
