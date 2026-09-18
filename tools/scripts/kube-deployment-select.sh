#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"
# kube-deployment-select.sh - Interactive Kubernetes deployment selection
# Uses fzf for interactive selection when multiple deployments match

set -euo pipefail
source "$DEVENV_TOOLS/lib/fzf-selection.bash"


# Source fzf-selection library

# Check fzf is installed
check_fzf_installed || exit 1

source "$DEVENV_TOOLS/lib/kube-selection.bash"

# shellcheck disable=SC2034  # argv is consumed via nameref by parse_namespace_flag
argv=("$@")
FILTER="${1:-}"
HEADER="${2:-Select a deployment}"

parse_namespace_flag argv || true
NS=$(resolve_namespace "${NAMESPACE_FLAG_VALUE:-}")
HEADER="$HEADER (ns: $NS)"

# Get deployments in the resolved namespace, apply optional name filter
DEPLOY_LIST=$(kubectl get deployments -n "$NS" --no-headers | awk '{print $1}')

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
