#!/usr/bin/env bash
# Retrieve the public IP with resilient fallbacks

set -euo pipefail

providers=(
	"https://ipinfo.io/ip"
	"https://api.ipify.org"
	"https://ifconfig.me"
)

for url in "${providers[@]}"; do
	if ip=$(curl -fsSL "$url" 2>/dev/null); then
		echo "$ip"
		exit 0
	fi
done

echo "Unable to determine public IP" >&2
exit 1
