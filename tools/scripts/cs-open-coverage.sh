#!/bin/bash
set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"

# Detect available browser
BROWSER=""
if command -v chromium &> /dev/null; then
    BROWSER="chromium"
elif command -v firefox &> /dev/null; then
    BROWSER="firefox"
else
    echo "Error: Neither chromium nor firefox is installed"
    exit 1
fi

files=$(find . -type f -name index.html | grep coverage.report)
for file in $files; do
    echo "Opening $file in $BROWSER"
    nohup $BROWSER $file </dev/null &>/dev/null &
done

if [ "$DEVCONTAINER" == "true" ]; then
    echo "Running in devcontainer, run desktop viewer to view"
fi
