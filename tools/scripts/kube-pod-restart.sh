#!/bin/bash

# Ensure correct usage
if [ $# -lt 1 ]; then
    echo "Usage: $0 <partial-deployment-name> [namespace]"
    exit 1
fi

DEPLOYMENT_NAME_PART="$1"
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

# Get the current number of replicas
CURRENT_REPLICAS=$(kubectl get deployment $DEPLOYMENT_NAME $NAMESPACE_OPTION -o json | jq -r ".spec.replicas")

# Check if we got a valid number
if [ -z "$CURRENT_REPLICAS" ] || [ "$CURRENT_REPLICAS" = "null" ]; then
    echo "Could not determine the current number of replicas for $DEPLOYMENT_NAME."
    exit 1
fi

echo "Restarting deployment: $DEPLOYMENT_NAME (Current replicas: $CURRENT_REPLICAS)"

# Scale to 0
echo "Scaling $DEPLOYMENT_NAME to 0 replicas..."
kubectl scale deployment $DEPLOYMENT_NAME --replicas=0 $NAMESPACE_OPTION

# Wait for the pods to terminate
echo "Waiting for pods to terminate..."
sleep 5  # Adjust the sleep time as needed

# Scale back to the original number
echo "Scaling $DEPLOYMENT_NAME back to $CURRENT_REPLICAS replicas..."
kubectl scale deployment $DEPLOYMENT_NAME --replicas=$CURRENT_REPLICAS $NAMESPACE_OPTION

echo "Deployment $DEPLOYMENT_NAME restarted successfully."
