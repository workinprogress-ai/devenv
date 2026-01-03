#!/bin/bash

files=$(find . -type f -name index.html | grep coverage.report)
for file in $files; do
    echo "Opening $file in chromium"
    nohup chromium $file </dev/null &>/dev/null &
done

if [ "$DEVCONTAINER" == "true" ]; then
    echo "Running in devcontainer, run desktop viewer to view"
fi
