#!/bin/bash
# kube-deployment-select.sh - Interactive Kubernetes deployment selection
# Uses fzf for interactive selection when multiple deployments match

set -euo pipefail
source "$DEVENV_TOOLS/lib/fzf-selection.bash"


# Source fzf-selection library

# Check fzf is installed
check_fzf_installed || exit 1

FILTER="${1:-}"
HEADER="${2:-Select a deployment}"

# Get deployments, apply optional name filter
DEPLOY_LIST=$(kubectl get deployments --no-headers | awk '{print $1}')

# Apply filter if provided
if [ -n "$FILTER" ]; then
    DEPLOY_LIST=$(echo "$DEPLOY_LIST" | grep -i "$FILTER")
fi

# Handle empty results
if [ -z "$DEPLOY_LIST" ]; then
    echo "No matching deployments found." >&2
    exit 1
fi

# Use smart selection: auto-select if 1 deployment, show menu if multiple
fzf_select_smart "$DEPLOY_LIST" "$HEADER"
