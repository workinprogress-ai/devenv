#!/bin/bash
set -euo pipefail
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$DEVENV_TOOLS/lib/error-handling.bash"

################################################################################
# kube-pod-exec.sh
#
# Execute a command in a Kubernetes pod
#
# Usage:
#   ./kube-pod-exec.sh <pod-name-part> <command>
#
# Environment Variables:
#   NAMESPACE - Kubernetes namespace (optional)
#
# Dependencies:
#   - kubectl
#
################################################################################

POD_NAME_PART="${1:?usage: kube-pod-exec.sh <pod-name-part> <command> }"
NAMESPACE_OPTION=""

if [ -n "${NAMESPACE:-}" ]; then
    NAMESPACE_OPTION="-n $NAMESPACE"
fi

shift

# Find matching pods
POD_NAME=$(kube-pod-select.sh $POD_NAME_PART)

# Check if a pod was found
if [ -z "$POD_NAME" ]; then
    echo "No matching pod found for pattern: $POD_NAME_PART"
    exit 1
fi

echo "Executing command for pod: $POD_NAME"
kubectl exec $POD_NAME $NAMESPACE_OPTION -- "$@"
