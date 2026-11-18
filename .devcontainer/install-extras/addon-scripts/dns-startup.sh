#!/bin/bash
set -e

# Path overrides (environment variables; defaults are the real system paths):
#   DEVENV_DNS_CONF_DIR       dnsmasq configuration directory   (/etc/dnsmasq.d)
#   DEVENV_DNS_RESOLV_CONF    the system resolver file          (/etc/resolv.conf)
#   DEVENV_DNS_UPSTREAM_FILE  dnsmasq's upstream resolver file  (/etc/resolv.dnsmasq)
CONF_DIR="${DEVENV_DNS_CONF_DIR:-/etc/dnsmasq.d}"
RESOLV_CONF="${DEVENV_DNS_RESOLV_CONF:-/etc/resolv.conf}"
UPSTREAM_FILE="${DEVENV_DNS_UPSTREAM_FILE:-/etc/resolv.dnsmasq}"

# Addresses that name dnsmasq itself (it serves on 127.0.0.1 and ::1): the
# loopback spellings 127.0.0.1, 127.1 and 127.0.1, the unspecified addresses
# 0.0.0.0 and ::, and ::1 in its short, 8-group and zero-padded forms (any IPv6
# spelling may carry a %zone suffix; hex digits are case-insensitive). Other
# loopback addresses are real upstreams: Docker's embedded resolver (127.0.0.11)
# and a systemd-resolved stub (127.0.0.53) are separate resolvers dnsmasq can
# forward to.
is_self_address() {
    local addr="${1,,}"
    case "$addr" in
        127.0.0.1 | 127.1 | 127.0.1 | 0.0.0.0) return 0 ;;
        ::1 | ::1%* | ::%* | ::) return 0 ;;
        0:0:0:0:0:0:0:1 | 0:0:0:0:0:0:0:1%*) return 0 ;;
        0000:0000:0000:0000:0000:0000:0000:0001 | 0000:0000:0000:0000:0000:0000:0000:0001%*) return 0 ;;
        *) return 1 ;;
    esac
}

# Prints the upstream view of a resolver file, the single place that decides
# what a line means: a trailing carriage return and everything from the first
# '#' or ';' is dropped and whitespace is trimmed before a line is read. Then
# every usable nameserver line (key "nameserver" in any letter case, a non-empty
# value that is not dnsmasq itself) is printed as "nameserver <value>", and
# search, domain and options lines are kept, in the original order. Comments and
# all other lines are dropped.
filter_resolv() {
    local file="$1" line key value rest
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        line="${line%%[#;]*}"
        read -r key rest <<< "$line"
        case "${key,,}" in
            nameserver)
                read -r value _ <<< "$rest"
                [ -n "$value" ] && ! is_self_address "$value" && printf 'nameserver %s\n' "$value"
                ;;
            search | domain | options) printf '%s%s\n' "$key" "${rest:+ $rest}" ;;
        esac
    done < "$file"
    return 0
}

# Succeeds when the file holds at least one usable nameserver, which is exactly
# when its filtered upstream view contains a nameserver line. An already-hijacked
# resolv.conf names only dnsmasq's own address, so it has none.
has_real_nameserver() {
    local file="$1"
    [ -r "$file" ] || return 1
    filter_resolv "$file" | grep -q '^nameserver '
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
# Write the filtered Docker-provided resolv.conf to the place defined in our
# static config earlier, but only when it names a real nameserver (anything but
# dnsmasq's own 127.0.0.1 / ::1). A resolv.conf that only points at dnsmasq was
# already hijacked by a previous run; using it would make dnsmasq forward to
# itself, so the existing upstream file is kept instead. The upstream file never
# receives dnsmasq's own address, even when resolv.conf lists it next to real ones.
if has_real_nameserver "$RESOLV_CONF"; then
    filter_resolv "$RESOLV_CONF" | sudo tee "$UPSTREAM_FILE" > /dev/null
elif has_real_nameserver "$UPSTREAM_FILE"; then
    echo "   $RESOLV_CONF names no real nameserver; keeping existing $UPSTREAM_FILE."
elif [ -f "$UPSTREAM_FILE" ]; then
    # A poisoned upstream file (naming only dnsmasq itself, empty or comments only) would make
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
