#!/bin/bash

# Ensure a search string is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <partial-pod-name> [namespace]"
    exit 1
fi

POD_NAME_PART="$1"
NAMESPACE_OPTION=""

if [ -n "$NAMESPACE" ]; then
    NAMESPACE_OPTION="-n $NAMESPACE"
fi

# Find matching pods
POD_NAME=$(kube-pod-select.sh $POD_NAME_PART)

# Check if a pod was found
if [ -z "$POD_NAME" ]; then
    echo "No matching pod found for pattern: $POD_NAME_PART"
    exit 1
fi

echo "Deleting pod: $POD_NAME"
kubectl delete pod $POD_NAME $NAMESPACE_OPTION
