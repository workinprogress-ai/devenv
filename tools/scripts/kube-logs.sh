#!/bin/bash
set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/kube-selection.bash"

################################################################################
# kube-logs.sh
#
# Retrieve logs from a Kubernetes pod
#
# Usage:
#   ./kube-logs.sh <pod-name-part> [-n|--namespace <ns>] [kubectl-options...]
#
# Namespace resolution: -n/--namespace flag > NAMESPACE env var > partial-match
# on the cluster's namespaces > interactive fzf picker (TTY) > current-context
# default (non-TTY). Partial matches resolve when unique; ambiguity offers a
# filtered picker.
#
# Environment Variables:
#   NAMESPACE - Kubernetes namespace (optional; overridden by the flag)
#
# Dependencies:
#   - kubectl
#   - kube-pod-select.sh
#
################################################################################

# shellcheck disable=SC2034  # argv is consumed via nameref by parse_namespace_flag
argv=("$@")
POD_NAME_PART="${1:?usage: kube-logs.sh <pod-name-part> [-n|--namespace <ns>] [kubectl-options...] }"
shift

# Namespace resolution: flag > env > partial match > picker > context default.
parse_namespace_flag argv || true
NAMESPACE=$(resolve_namespace "${NAMESPACE_FLAG_VALUE:-}")

# Find matching pods
POD_NAME=$(NAMESPACE="$NAMESPACE" kube-pod-select.sh "$POD_NAME_PART")

# Check if a pod was found
if [ -z "$POD_NAME" ]; then
    echo "No matching pod found for pattern: $POD_NAME_PART"
    exit 1
fi

echo "Fetching logs for pod: $POD_NAME in namespace: $NAMESPACE"
kubectl logs "$POD_NAME" -n "$NAMESPACE" "$@"
