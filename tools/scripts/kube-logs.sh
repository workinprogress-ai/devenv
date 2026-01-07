#!/bin/bash

################################################################################
# kube-logs.sh
#
# Retrieve logs from a Kubernetes pod
#
# Usage:
#   ./kube-logs.sh <pod-name-part> [kubectl-options...]
#
# Environment Variables:
#   NAMESPACE - Kubernetes namespace (optional)
#
# Dependencies:
#   - kubectl
#   - kube-pod-select.sh
#
################################################################################

POD_NAME_PART="$1"
NAMESPACE_OPTION=""

if [ -n "$NAMESPACE" ]; then
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

echo "Fetching logs for pod: $POD_NAME"
kubectl logs $POD_NAME $NAMESPACE_OPTION "$@"
