#!/bin/bash
set -e

# Guard Clause: Fail fast if the install script wasn't run.
if ! command -v dnsmasq &> /dev/null; then
    echo "DNS hijack does not appear to be installed."
    exit 0
fi

CONFIG_PATH=""
for candidate in /etc/dnsmasq.d/devenv-split.conf /etc/dnsmasq.d/split-dns.conf /etc/dnsmasq.d/omsnic-split.conf; do
    if [ -f "$candidate" ]; then
        CONFIG_PATH="$candidate"
        break
    fi
done

if [ -z "$CONFIG_PATH" ]; then
    echo "DNS hijack does not appear to be installed."
    exit 0
fi

echo "🚀 [DNS Startup] Configuring runtime network..."

# 1. Capture the Host/VPN DNS
# We copy the current Docker-provided resolv.conf to the place
# defined in our static config earlier.
sudo cp /etc/resolv.conf /etc/resolv.dnsmasq

# 2. Restart the Service
# This forces dnsmasq to reload config and see the new upstream file.
sudo service dnsmasq restart

# 3. The Hijack
# Point the OS to localhost.
sudo bash -c 'echo "nameserver 127.0.0.1" > /etc/resolv.conf'

echo "✅ [DNS Startup] Split DNS active."