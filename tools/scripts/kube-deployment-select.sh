#!/bin/bash
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
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
