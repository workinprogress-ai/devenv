#!/bin/bash
set -euo pipefail

################################################################################
# kube-pod-scale.sh
#
# Scale a Kubernetes deployment to a specified replica count
#
# Usage:
#   ./kube-pod-scale.sh <deployment-name-part> <replica-count> [namespace]
#
# Environment Variables:
#   NAMESPACE - Kubernetes namespace (optional)
#   YES       - set to 1 to skip the confirmation prompt
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
if [ $# -lt 2 ]; then
    echo "Usage: $0 <partial-deployment-name> <replicas> [namespace]"
    echo "Environment: YES=1 skips the confirmation prompt."
    exit "$EXIT_MISUSE"
fi

DEPLOYMENT_NAME_PART="$1"
REPLICAS="$2"

# Replica count must be a non-negative integer before anything touches kubectl.
if ! [[ "$REPLICAS" =~ ^[0-9]+$ ]]; then
    log_error "Replica count must be a non-negative integer, got: '$REPLICAS'"
    exit "$EXIT_MISUSE"
fi

# Resolve the name fragment to exactly one deployment: refuses on zero matches
# and on multiple matches (candidates listed) so a partial name can never
# scale an unintended workload.
DEPLOYMENT_NAME=$(resolve_single_match list_deployments --filter "$DEPLOYMENT_NAME_PART" --namespace "${NAMESPACE:-}") || {
    rc=$?
    exit "$rc"
}

# Get namespace option for kubectl commands
NS_OPTION=$(get_namespace_option "${NAMESPACE:-}")

confirm_or_fail "Scale deployment '$DEPLOYMENT_NAME' to $REPLICAS replicas${NAMESPACE:+ in namespace $NAMESPACE}"

echo "Scaling deployment: $DEPLOYMENT_NAME to $REPLICAS replicas..."

# shellcheck disable=SC2086  # NS_OPTION should not be quoted (can be empty)
kubectl scale deployment "$DEPLOYMENT_NAME" --replicas="$REPLICAS" $NS_OPTION
