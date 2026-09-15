#!/bin/bash
set -euo pipefail
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
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
