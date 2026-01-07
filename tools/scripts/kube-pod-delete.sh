#!/bin/bash

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/kube-selection.bash"


# Ensure a search string is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <partial-pod-name> [namespace]"
    exit 1
fi

POD_NAME_PART="$1"

# Find matching pod using library function
POD_NAME=$(list_pods --namespace "${NAMESPACE:-}" --filter "$POD_NAME_PART" | head -n 1)

# Check if a pod was found
if [ -z "$POD_NAME" ]; then
    echo "No matching pod found for pattern: $POD_NAME_PART"
    exit 1
fi

# Get namespace option for kubectl commands
NS_OPTION=$(get_namespace_option "${NAMESPACE:-}")

echo "Deleting pod: $POD_NAME"

# shellcheck disable=SC2086  # NS_OPTION should not be quoted (can be empty)
kubectl delete pod "$POD_NAME" $NS_OPTION
