#!/bin/bash
# kube-set-context.sh - Switch Kubernetes context with smart selection
# Uses fzf for interactive selection when multiple contexts match

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

# Get all available contexts
contexts=$(kubectl config get-contexts -o name)
if [ -z "$contexts" ]; then
    echo "No clusters found."
    exit 1
fi

# Filter by partial name if provided
if [[ -n "${1:-}" ]]; then
    contexts=$(echo "$contexts" | grep -iF "$1")
    
    if [ -z "$contexts" ]; then
        echo "Error: No clusters match '$1'." >&2
        exit 1
    fi
fi

# Use smart selection from library
selected=$(fzf_select_smart "$contexts" "Select a cluster: ")

if ! fzf_validate_selection "$selected" "cluster"; then
    exit 1
fi

# Switch to selected context
kubectl config use-context "$selected" >/dev/null
echo "Switched to context: $(kubectl config current-context)" >&2
