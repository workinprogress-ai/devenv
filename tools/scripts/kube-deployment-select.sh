#!/bin/bash

# Ensure fzf is installed
if ! command -v fzf &> /dev/null; then
    echo "Error: fzf is not installed. Install it and try again."
    exit 1
fi

FILTER="$1"
HEADER="${2:-Select a deployment}"

# Get deployments, apply optional name filter
DEPLOY_LIST=$(kubectl get deployments --no-headers | awk '{print $1}' | grep -i "${FILTER}")

DEPLOY_COUNT=$(echo "$DEPLOY_LIST" | wc -l)

if [ "$DEPLOY_COUNT" -eq 0 ]; then
    echo "No matching deployments found." >&2
    exit 1
elif [ "$DEPLOY_COUNT" -eq 1 ]; then
    echo "$DEPLOY_LIST"
else
    echo "$DEPLOY_LIST" | fzf --header="$HEADER"
fi
