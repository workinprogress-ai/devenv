#!/bin/bash

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/kube-selection.bash"

# Ensure correct usage
if [ $# -lt 2 ]; then
    echo "Usage: $0 <partial-deployment-name> <replicas> [namespace]"
    exit 1
fi

DEPLOYMENT_NAME_PART="$1"
REPLICAS="$2"

# Find matching deployment using library function
DEPLOYMENT_NAME=$(list_deployments --namespace "${NAMESPACE:-}" --filter "$DEPLOYMENT_NAME_PART" | head -n 1)

# Check if a deployment was found
if [ -z "$DEPLOYMENT_NAME" ]; then
    echo "No matching deployment found for pattern: $DEPLOYMENT_NAME_PART"
    exit 1
fi

# Get namespace option for kubectl commands
NS_OPTION=$(get_namespace_option "${NAMESPACE:-}")

echo "Scaling deployment: $DEPLOYMENT_NAME to $REPLICAS replicas..."

# shellcheck disable=SC2086  # NS_OPTION should not be quoted (can be empty)
kubectl scale deployment "$DEPLOYMENT_NAME" --replicas="$REPLICAS" $NS_OPTION
