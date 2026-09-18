#!/usr/bin/env bash
source "$DEVENV_TOOLS/lib/error-handling.bash"
# Retrieve the public IP with resilient fallbacks

set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

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
