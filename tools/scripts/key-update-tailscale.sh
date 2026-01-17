#!/usr/bin/env bash
# update-tailscale.sh
# Updates the Tailscale auth key and re-authenticates the daemon
# Usage: update-tailscale.sh

set -euo pipefail

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

# 1. Capture New Key
read -s -p "    Paste new Reusable Auth Key: " NEW_KEY
echo "" # Newline

if [ -z "$NEW_KEY" ]; then
    error_exit "No key provided. Operation cancelled."
fi

# Validate key format (should start with tskey-)
if [[ ! "$NEW_KEY" =~ ^tskey- ]]; then
    error_exit "Invalid key format. Tailscale auth keys start with 'tskey-'"
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
    error_exit "Failed to authenticate. Please check if the key is valid and not expired."
fi
