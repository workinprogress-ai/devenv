#!/bin/bash
set -e

# Path overrides (environment variables; defaults are the real system paths):
#   DEVENV_DNS_CONF_DIR       dnsmasq configuration directory   (/etc/dnsmasq.d)
#   DEVENV_DNS_RESOLV_CONF    the system resolver file          (/etc/resolv.conf)
#   DEVENV_DNS_UPSTREAM_FILE  dnsmasq's upstream resolver file  (/etc/resolv.dnsmasq)
# dns-startup.sh honours the same names. This installer reads CONF_DIR and
# UPSTREAM_FILE; the resolv.conf path is only used by the startup script.
CONF_DIR="${DEVENV_DNS_CONF_DIR:-/etc/dnsmasq.d}"
UPSTREAM_FILE="${DEVENV_DNS_UPSTREAM_FILE:-/etc/resolv.dnsmasq}"

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
# The mapping file is appended as data, so its content is never expanded.
CONF_FILE="${CONF_DIR}/devenv-split.conf"
{
    printf '%s\n' \
        "# Point to the file where we will dump the real upstream DNS at runtime" \
        "resolv-file=${UPSTREAM_FILE}" \
        "" \
        "# Strict ordering ensures we try the specific servers first (optional but good practice)" \
        "strict-order" \
        "" \
        "# The Domain mappings"
    printf '%s\n' "$(cat "${CONFIG_FILE}")"
} | sudo tee "${CONF_FILE}" > /dev/null

# dns-startup.sh prefers devenv-split.conf; flag any other split file left behind.
for other in "${CONF_DIR}"/*-split.conf; do
    if [[ -f "${other}" && "${other}" != "${CONF_FILE}" ]]; then
        echo "⚠️  [DNS Install] Another configuration file exists: ${other}; dns-startup.sh uses ${CONF_FILE} first."
    fi
done

echo "✅ [DNS Install] Configuration written to ${CONF_FILE}"

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