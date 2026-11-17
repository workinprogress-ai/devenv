#!/bin/bash
set -e

# Path overrides (environment variables; defaults are the real system paths):
#   DEVENV_DNS_CONF_DIR       dnsmasq configuration directory   (/etc/dnsmasq.d)
#   DEVENV_DNS_RESOLV_CONF    the system resolver file          (/etc/resolv.conf)
#   DEVENV_DNS_UPSTREAM_FILE  dnsmasq's upstream resolver file  (/etc/resolv.dnsmasq)
CONF_DIR="${DEVENV_DNS_CONF_DIR:-/etc/dnsmasq.d}"
RESOLV_CONF="${DEVENV_DNS_RESOLV_CONF:-/etc/resolv.conf}"
UPSTREAM_FILE="${DEVENV_DNS_UPSTREAM_FILE:-/etc/resolv.dnsmasq}"

# Succeeds when the file names at least one nameserver that is not loopback
# (127.x.x.x or ::1). An already-hijacked resolv.conf names only loopback.
has_real_nameserver() {
    local file="$1" key value _
    [ -r "$file" ] || return 1
    while read -r key value _ || [ -n "$key" ]; do
        [ "$key" = "nameserver" ] || continue
        case "$value" in
            127.* | ::1 | ::1%*) ;;
            *) return 0 ;;
        esac
    done < "$file"
    return 1
}

# Guard Clause: Fail fast if the install script wasn't run.
if ! command -v dnsmasq &> /dev/null; then
    echo "DNS hijack does not appear to be installed."
    exit 0
fi

# The installer writes devenv-split.conf; split-dns.conf and any other
# *-split.conf (for example one carrying an organisation prefix from an
# earlier install) are accepted too, first match wins.
CONFIG_PATH=""
for candidate in "$CONF_DIR/devenv-split.conf" "$CONF_DIR/split-dns.conf"; do
    if [ -f "$candidate" ]; then
        CONFIG_PATH="$candidate"
        break
    fi
done
if [ -z "$CONFIG_PATH" ]; then
    for candidate in "$CONF_DIR"/*-split.conf; do
        if [ -f "$candidate" ]; then
            CONFIG_PATH="$candidate"
            break
        fi
    done
fi

if [ -z "$CONFIG_PATH" ]; then
    echo "DNS hijack does not appear to be installed."
    exit 0
fi

echo "🚀 [DNS Startup] Configuring runtime network..."

# 1. Capture the Host/VPN DNS
# Copy the current Docker-provided resolv.conf to the place defined in our
# static config earlier, but only when it names a real (non-loopback)
# nameserver. A resolv.conf that only points at localhost was already hijacked
# by a previous run; copying it would make dnsmasq forward to itself, so the
# existing upstream file is kept instead.
if has_real_nameserver "$RESOLV_CONF"; then
    sudo cp "$RESOLV_CONF" "$UPSTREAM_FILE"
elif has_real_nameserver "$UPSTREAM_FILE"; then
    echo "   $RESOLV_CONF names no real nameserver; keeping existing $UPSTREAM_FILE."
elif [ -f "$UPSTREAM_FILE" ]; then
    # A poisoned upstream file (loopback-only, empty or comments only) would make
    # dnsmasq forward to itself, so it is not kept.
    echo "⚠️  [DNS Startup] $RESOLV_CONF and the existing $UPSTREAM_FILE name no real nameserver; leaving DNS unchanged."
    exit 0
else
    echo "⚠️  [DNS Startup] $RESOLV_CONF names no real nameserver and $UPSTREAM_FILE does not exist; leaving DNS unchanged."
    exit 0
fi

# 2. Restart the Service
# This forces dnsmasq to reload config and see the new upstream file.
sudo service dnsmasq restart

# 3. The Hijack
# Point the OS to localhost.
printf 'nameserver 127.0.0.1\n' | sudo tee "$RESOLV_CONF" > /dev/null

echo "✅ [DNS Startup] Split DNS active."
