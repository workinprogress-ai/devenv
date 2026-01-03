#!/bin/bash

# Ensure fzf is installed
if ! command -v fzf &> /dev/null; then
    echo "Error: fzf is not installed. Install it and try again."
    exit 1
fi

HEADER="Select a pod"
if [ -n "$2" ]; then
    HEADER="$2"
fi

# Run kube-list-pods.sh with optional arguments
POD_LIST=$(kube-list-pods.sh "$1")

# Count the number of lines in the output
POD_COUNT=$(echo "$POD_LIST" | wc -l)

# Handle cases based on the number of pods found
if [ "$POD_COUNT" -eq 0 ]; then
    echo "No matching pods found." >&2
    exit 1
elif [ "$POD_COUNT" -eq 1 ]; then
    echo "$POD_LIST"
else
    echo "$POD_LIST" | fzf --header="$HEADER" 
fi
