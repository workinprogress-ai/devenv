#!/bin/bash

################################################################################
# kube-pod-console.sh
#
# Open an interactive console/shell to a Kubernetes pod
#
# Usage:
#   ./kube-pod-console.sh <pod-name-part> [kubectl-options...]
#
# Environment Variables:
#   NAMESPACE - Kubernetes namespace (optional)
#
# Dependencies:
#   - kubectl
#   - error-handling.bash
#   - kube-selection.bash
#
################################################################################

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/kube-selection.bash"


POD_NAME_PART="$1"

shift

# Find matching pod using library function
POD_NAME=$(list_pods --namespace "${NAMESPACE:-}" --filter "$POD_NAME_PART" | head -n 1)

# Check if a pod was found
if [ -z "$POD_NAME" ]; then
    echo "No matching pod found for pattern: $POD_NAME_PART"
    exit 1
fi

# Get namespace option for kubectl commands
NS_OPTION=$(get_namespace_option "${NAMESPACE:-}")

if [ $# -eq 0 ]; then
    echo "No command provided to execute on the pod.  Executing /bin/bash by default."
    set -- /bin/bash
fi
echo "Executing command on console for pod: $POD_NAME"

# shellcheck disable=SC2086  # NS_OPTION should not be quoted (can be empty)
kubectl exec -it "$POD_NAME" $NS_OPTION -- "$@"
