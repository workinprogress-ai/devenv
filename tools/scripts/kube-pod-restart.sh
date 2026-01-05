#!/bin/bash

# Source libraries
if [ -f "${DEVENV_ROOT}/tools/lib/error-handling.bash" ]; then
    source "${DEVENV_ROOT}/tools/lib/error-handling.bash"
fi

if [ -f "${DEVENV_ROOT}/tools/lib/kube-selection.bash" ]; then
    source "${DEVENV_ROOT}/tools/lib/kube-selection.bash"
fi

# Ensure correct usage
if [ $# -lt 1 ]; then
    echo "Usage: $0 <partial-deployment-name> [namespace]"
    exit 1
fi

DEPLOYMENT_NAME_PART="$1"

# Find matching deployment using library function
DEPLOYMENT_NAME=$(list_deployments --namespace "${NAMESPACE:-}" --filter "$DEPLOYMENT_NAME_PART" | head -n 1)

# Check if a deployment was found
if [ -z "$DEPLOYMENT_NAME" ]; then
    echo "No matching deployment found for pattern: $DEPLOYMENT_NAME_PART"
    exit 1
fi

# Get namespace option for kubectl commands
NS_OPTION=$(get_namespace_option "${NAMESPACE:-}")

# Get the current number of replicas using library function
DEPLOYMENT_INFO=$(get_deployment_info --namespace "${NAMESPACE:-}" "$DEPLOYMENT_NAME")
CURRENT_REPLICAS=$(echo "$DEPLOYMENT_INFO" | jq -r ".spec.replicas // 0")

# Check if we got a valid number
if [ -z "$CURRENT_REPLICAS" ] || [ "$CURRENT_REPLICAS" = "null" ]; then
    echo "Could not determine the current number of replicas for $DEPLOYMENT_NAME."
    exit 1
fi

echo "Restarting deployment: $DEPLOYMENT_NAME (Current replicas: $CURRENT_REPLICAS)"

# Scale to 0
echo "Scaling $DEPLOYMENT_NAME to 0 replicas..."
# shellcheck disable=SC2086  # NS_OPTION should not be quoted (can be empty)
kubectl scale deployment "$DEPLOYMENT_NAME" --replicas=0 $NS_OPTION

# Wait for the pods to terminate
echo "Waiting for pods to terminate..."
sleep 5

# Scale back to the original number
echo "Scaling $DEPLOYMENT_NAME back to $CURRENT_REPLICAS replicas..."
# shellcheck disable=SC2086  # NS_OPTION should not be quoted (can be empty)
kubectl scale deployment "$DEPLOYMENT_NAME" --replicas="$CURRENT_REPLICAS" $NS_OPTION

echo "Deployment $DEPLOYMENT_NAME restarted successfully."
