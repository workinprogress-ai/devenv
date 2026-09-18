#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"
# kube-set-context.sh - Switch Kubernetes context with smart selection
# Uses fzf for interactive selection when multiple contexts match

set -euo pipefail
source "$DEVENV_TOOLS/lib/fzf-selection.bash"


# Source fzf-selection library

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
