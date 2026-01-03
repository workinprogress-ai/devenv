#!/bin/bash

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

if [ $# -eq 0 ]; then
    echo "No command provided to execute on the pod.  Executing /bin/bash by default."
    set -- /bin/bash
fi
echo "Executing command on console for pod: $POD_NAME"
kubectl exec -it $POD_NAME $NAMESPACE_OPTION -- "$@"
