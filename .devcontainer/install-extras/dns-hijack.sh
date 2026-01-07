#!/bin/bash
set -e

echo "🔧 [DNS Install] Setting up dnsmasq and static rules..."

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config/dns-mapping.cfg"

# Check if config file exists
if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "❌ [DNS Install] ERROR: Configuration file not found at: ${CONFIG_FILE}"
    echo "   Please create the file with domain mappings in the format:"
    echo "   server=/domain.name/IP_ADDRESS"
    exit 1
fi

echo "   Found DNS mapping config: ${CONFIG_FILE}"

# 1. Install dependencies
# (Check if installed first to keep it idempotent-ish)
if ! command -v dnsmasq &> /dev/null; then
    sudo apt-get update && sudo apt-get install -y dnsmasq dnsutils
else
    echo "   dnsmasq already installed."
fi

# 2. Configure the Split Horizon (Static Config)
# We define the upstream file location HERE, even though the file 
# won't be populated until runtime. This keeps config out of the startup script.
sudo bash -c "cat << EOF > /etc/dnsmasq.d/omsnic-split.conf
# Point to the file where we will dump the real upstream DNS at runtime
resolv-file=/etc/resolv.dnsmasq

# Strict ordering ensures we try the specific servers first (optional but good practice)
strict-order

# The Domain mappings
$(cat "${CONFIG_FILE}")
EOF"

echo "✅ [DNS Install] Configuration written to /etc/dnsmasq.d/omsnic-split.conf"

# 3. Add DNS startup script to custom startup
echo "🔧 [DNS Install] Registering DNS startup script..."
DNS_STARTUP_SCRIPT="${SCRIPT_DIR}/addon-scripts/dns-startup.sh"

if [[ -f "${DNS_STARTUP_SCRIPT}" ]]; then
    devenv-add-custom-startup "${DNS_STARTUP_SCRIPT}"
    echo "✅ [DNS Install] DNS startup script registered - will run on container start"
else
    echo "⚠️  [DNS Install] WARNING: DNS startup script not found at ${DNS_STARTUP_SCRIPT}"
    echo "   DNS will need to be manually started after container restarts"
fi

echo "✅ [DNS Install] Setup complete!"