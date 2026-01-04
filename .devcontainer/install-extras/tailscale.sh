#!/usr/bin/env bash
set -euo pipefail

# Install and configure Tailscale VPN in the dev container
# Tailscale provides secure networking between devices via WireGuard
# This script configures userspace networking with SOCKS5 proxy support
#
# Usage: bash .devcontainer/install-extras/tailscale.sh
#
# Requirements:
# - Tailscale auth key (will prompt if not set as TS_AUTHKEY env var)
# - Desired hostname for this container
#
# Creates:
# - Tailscale daemon running in userspace mode
# - SOCKS5 proxy on port 1055 for routing traffic
# - Environment variables for proxy configuration
# - Startup commands to reconnect on container restart

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVENV_ROOT="${DEVENV_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

# Configuration
TS_PROXY_PORT="1055"
TS_STATE_DIR="/var/lib/tailscale"
TS_SOCKET="/var/run/tailscale/tailscaled.sock"

echo ">>> 🛠️  Starting Tailscale Installation & Configuration..."

# 1. Install Tailscale Binary (Idempotent)
if ! command -v tailscale &> /dev/null; then
    echo "    - Tailscale not found. Downloading..."
    curl -fsSL https://tailscale.com/install.sh | sh
else
    echo "    - Tailscale is already installed."
fi

# 2. Capture Inputs (Interactive)
echo "    -------------------------------------------------------"
echo "    🔑 TAILSCALE SETUP"
echo "    -------------------------------------------------------"

# Check/Ask for Auth Key
if [ -n "${TS_AUTHKEY:-}" ]; then
    echo "    - TS_AUTHKEY found in environment."
else
    echo "    Please paste your Tailscale Auth Key (tskey-auth-...)."
    echo "    (Input is hidden)"
    read -s -p "    Key: " INPUT_AUTH_KEY
    echo "" # Newline
    
    if [ -z "$INPUT_AUTH_KEY" ]; then
        echo "    ❌ Error: No key provided."
        exit 1
    fi
    
    # Save Key via helper
    "$DEVENV_TOOLS/devenv-add-env-vars" "TS_AUTHKEY=$INPUT_AUTH_KEY"
    export TS_AUTHKEY="$INPUT_AUTH_KEY"
fi

# Ask for Hostname to inject (suggest a default)
base_user="${GH_USER:-${USER:-dev}}"
base_user=$(echo "$base_user" | tr '[:upper:]' '[:lower:]')
base_user=$(echo "$base_user" | tr -c 'a-z0-9-' '-')
[ -z "$base_user" ] && base_user="dev"
rand_suffix=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 5 || true)
[ -z "$rand_suffix" ] && rand_suffix="${RANDOM}${RANDOM}" && rand_suffix=${rand_suffix:0:5}
DEFAULT_HOSTNAME="${base_user}-${rand_suffix}"

echo "    Please enter the Hostname for this dev container."
echo "    (Press Enter to accept the default)"
read -p "    Hostname [${DEFAULT_HOSTNAME}]: " INPUT_HOSTNAME

if [ -z "$INPUT_HOSTNAME" ]; then
    INPUT_HOSTNAME="$DEFAULT_HOSTNAME"
fi

# 3. Configure Proxy Environment Variables
echo "    - Configuring Proxy Env Vars..."
"$DEVENV_TOOLS/devenv-add-env-vars" "ALL_PROXY=socks5://localhost:$TS_PROXY_PORT"
"$DEVENV_TOOLS/devenv-add-env-vars" "HTTP_PROXY=socks5://localhost:$TS_PROXY_PORT"
"$DEVENV_TOOLS/devenv-add-env-vars" "HTTPS_PROXY=socks5://localhost:$TS_PROXY_PORT"
# Prevent proxying for local dev and internal container traffic
"$DEVENV_TOOLS/devenv-add-env-vars" "NO_PROXY=localhost,127.0.0.1,::1,172.16.0.0/12,192.168.0.0/16,.local"
# 4. Construct and Register Startup Logic
# We use a heredoc to define the exact script that runs on container startup.
# Variables are manually substituted into the heredoc string
echo "    - Registering startup commands..."

# Build the startup logic with variable substitution
STARTUP_LOGIC="echo '>>> 🚀 Tailscale Startup Hook'

# Ensure State Dir
sudo mkdir -p $TS_STATE_DIR

# 1. Start Daemon (Userspace)
if ! pgrep tailscaled > /dev/null; then
    sudo tailscaled \\
        --state=$TS_STATE_DIR/tailscaled.state \\
        --socket=$TS_SOCKET \\
        --tun=userspace-networking \\
        --socks5-server=localhost:$TS_PROXY_PORT &
    sleep 3
fi

# 2. Authenticate
if ! tailscale status &> /dev/null; then
    if [ -n \"\\\$TS_AUTHKEY\" ]; then
        sudo tailscale up \\
            --authkey=\"\\\$TS_AUTHKEY\" \\
            --hostname=\"$INPUT_HOSTNAME\" \\
            --accept-routes
    else
        echo '    ⚠️ Tailscale Key missing in startup.'
    fi
fi"

# Pass the logic to custom startup helper
"$DEVENV_TOOLS/devenv-add-custom-startup" "$STARTUP_LOGIC"


# 5. Immediate Execution (So it works now)
echo ">>> ✅ Setup complete. Attempting immediate connection..."
eval "$STARTUP_LOGIC"

echo ">>> 🟢 Tailscale should be up. Hostname: $INPUT_HOSTNAME"

