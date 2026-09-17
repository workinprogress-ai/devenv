#!/bin/bash
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$DEVENV_TOOLS/lib/error-handling.bash"
# kube-pod-select.sh - Interactive Kubernetes pod selection
# Uses fzf for interactive selection when multiple pods match

set -euo pipefail
source "$DEVENV_TOOLS/lib/fzf-selection.bash"


# Check fzf is installed
check_fzf_installed || exit 1

# Namespace: -n|--namespace <ns> (forwarded to kube-list-pods), or resolver default.
argv=("$@")
FILTER="${1:-}"

source "$DEVENV_TOOLS/lib/kube-selection.bash"
parse_namespace_flag argv || true
NS=$(resolve_namespace "${NAMESPACE_FLAG_VALUE:-}")

# Set header prompt
HEADER="Select a pod (ns: $NS)"
if [ -n "${argv[1]:-}" ]; then
    HEADER="${argv[1]}"
fi

# Run kube-list-pods.sh with the resolved namespace + filter
POD_LIST=$(kube-list-pods.sh -n "$NS" "$FILTER")

# Handle empty results
if [ -z "$POD_LIST" ]; then
    echo "No matching pods found." >&2
    exit 1
fi

# Use smart selection: auto-select if 1 pod, show menu if multiple
fzf_select_smart "$POD_LIST" "$HEADER"
