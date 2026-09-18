#!/bin/bash
set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

################################################################################
# kube-pod-restart.sh
#
# Restart a Kubernetes pod/deployment
#
# Usage:
#   ./kube-pod-restart.sh <deployment-name-part> [-n|--namespace <ns>]
#
# Environment Variables:
#   NAMESPACE - Kubernetes namespace (optional; overridden by the flag)
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
if [ $# -lt 1 ]; then
    echo "Usage: $0 <deployment-name-part> [-n|--namespace <ns>]"
    echo "Environment: YES=1 skips the confirmation prompt."
    exit "$EXIT_MISUSE"
fi

# shellcheck disable=SC2034  # argv is consumed via nameref by parse_namespace_flag
argv=("$@")
DEPLOYMENT_NAME_PART="$1"
shift

parse_namespace_flag argv || true
NAMESPACE=$(resolve_namespace "${NAMESPACE_FLAG_VALUE:-}")

# Resolve the name fragment to exactly one deployment: refuses on zero matches
# and on multiple matches (candidates listed) so a partial name can never
# restart an unintended workload.
DEPLOYMENT_NAME=$(resolve_single_match list_deployments --filter "$DEPLOYMENT_NAME_PART" --namespace "$NAMESPACE") || {
    rc=$?
    exit "$rc"
}

confirm_or_fail "Restart deployment '$DEPLOYMENT_NAME' (scale to 0 and back in namespace $NAMESPACE)"

# Get the current number of replicas using library function
DEPLOYMENT_INFO=$(get_deployment_info --namespace "$NAMESPACE" "$DEPLOYMENT_NAME")
CURRENT_REPLICAS=$(echo "$DEPLOYMENT_INFO" | jq -r ".spec.replicas // 0")

# Check if we got a valid number
if [ -z "$CURRENT_REPLICAS" ] || [ "$CURRENT_REPLICAS" = "null" ]; then
    echo "Could not determine the current number of replicas for $DEPLOYMENT_NAME."
    exit 1
fi

echo "Restarting deployment: $DEPLOYMENT_NAME (Current replicas: $CURRENT_REPLICAS)"

# Scale to 0
echo "Scaling $DEPLOYMENT_NAME to 0 replicas..."
kubectl scale deployment "$DEPLOYMENT_NAME" --replicas=0 -n "$NAMESPACE"

# Wait for the pods to terminate
echo "Waiting for pods to terminate..."
sleep 5

# Scale back to the original number
echo "Scaling $DEPLOYMENT_NAME back to $CURRENT_REPLICAS replicas..."

kubectl scale deployment "$DEPLOYMENT_NAME" --replicas="$CURRENT_REPLICAS" -n "$NAMESPACE"

echo "Deployment $DEPLOYMENT_NAME restarted successfully."
