#!/usr/bin/env bash
source "$DEVENV_TOOLS/lib/error-handling.bash"
# Retrieve the public IP with resilient fallbacks

set -euo pipefail
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

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
