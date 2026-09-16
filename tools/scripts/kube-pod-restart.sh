#!/bin/bash
set -euo pipefail
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

################################################################################
# kube-pod-restart.sh
#
# Restart a Kubernetes pod/deployment
#
# Usage:
#   ./kube-pod-restart.sh <pod-name-part> [namespace]
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

# Ensure correct usage
if [ $# -lt 1 ]; then
    echo "Usage: $0 <partial-deployment-name> [namespace]"
    echo "Environment: YES=1 skips the confirmation prompt."
    exit "$EXIT_MISUSE"
fi

DEPLOYMENT_NAME_PART="$1"

# Resolve the name fragment to exactly one deployment: refuses on zero matches
# and on multiple matches (candidates listed) so a partial name can never
# restart an unintended workload.
DEPLOYMENT_NAME=$(resolve_single_match list_deployments --filter "$DEPLOYMENT_NAME_PART" --namespace "${NAMESPACE:-}") || {
    rc=$?
    exit "$rc"
}

# Get namespace option for kubectl commands
NS_OPTION=$(get_namespace_option "${NAMESPACE:-}")

confirm_or_fail "Restart deployment '$DEPLOYMENT_NAME' (scale to 0 and back${NAMESPACE:+ in namespace $NAMESPACE})"

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
