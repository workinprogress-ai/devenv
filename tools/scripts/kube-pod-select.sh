#!/bin/bash
# kube-pod-select.sh - Interactive Kubernetes pod selection
# Uses fzf for interactive selection when multiple pods match

set -euo pipefail

# Source fzf-selection library
if [ -f "$DEVENV_ROOT/tools/lib/fzf-selection.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/fzf-selection.bash"
else
    echo "Error: fzf-selection.bash library not found" >&2
    exit 1
fi

# Check fzf is installed
check_fzf_installed || exit 1

# Set header prompt
HEADER="Select a pod"
if [ -n "${2:-}" ]; then
    HEADER="$2"
fi

# Run kube-list-pods.sh with optional arguments
POD_LIST=$(kube-list-pods.sh "${1:-}")

# Handle empty results
if [ -z "$POD_LIST" ]; then
    echo "No matching pods found." >&2
    exit 1
fi

# Use smart selection: auto-select if 1 pod, show menu if multiple
fzf_select_smart "$POD_LIST" "$HEADER"
