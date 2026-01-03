#!/bin/bash

# Ensure correct usage
if [ $# -lt 2 ]; then
    echo "Usage: $0 <partial-deployment-name> <replicas> [namespace]"
    exit 1
fi

DEPLOYMENT_NAME_PART="$1"
REPLICAS="$2"
NAMESPACE_OPTION=""

if [ -n "$NAMESPACE" ]; then
    NAMESPACE_OPTION="-n $NAMESPACE"
fi

# Find matching deployment
DEPLOYMENT_NAME=$(kubectl get deployments $NAMESPACE_OPTION -o json | jq -r ".items[].metadata.name | select(test(\"$DEPLOYMENT_NAME_PART\"))" | head -n 1
)

# Check if a deployment was found
if [ -z "$DEPLOYMENT_NAME" ]; then
    echo "No matching deployment found for pattern: $DEPLOYMENT_NAME_PART"
    exit 1
fi

echo "Scaling deployment: $DEPLOYMENT_NAME to $REPLICAS replicas..."
kubectl scale deployment $DEPLOYMENT_NAME --replicas=$REPLICAS $NAMESPACE_OPTION
