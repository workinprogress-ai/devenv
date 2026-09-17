#!/bin/bash
set -euo pipefail

################################################################################
# kube-pod-scale.sh
#
# Scale a Kubernetes deployment to a specified replica count
#
# Usage:
#   ./kube-pod-scale.sh <deployment-name-part> <replica-count> [-n|--namespace <ns>]
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
if [ $# -lt 2 ]; then
    echo "Usage: $0 <deployment-name-part> <replicas> [-n|--namespace <ns>]"
    echo "Environment: YES=1 skips the confirmation prompt."
    exit "$EXIT_MISUSE"
fi

# shellcheck disable=SC2034  # argv is consumed via nameref by parse_namespace_flag
argv=("$@")
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
shift 2

parse_namespace_flag argv || true
NAMESPACE=$(resolve_namespace "${NAMESPACE_FLAG_VALUE:-}")

DEPLOYMENT_NAME=$(resolve_single_match list_deployments --filter "$DEPLOYMENT_NAME_PART" --namespace "$NAMESPACE") || {
    rc=$?
    exit "$rc"
}

confirm_or_fail "Scale deployment '$DEPLOYMENT_NAME' to $REPLICAS replicas in namespace $NAMESPACE"

echo "Scaling deployment: $DEPLOYMENT_NAME to $REPLICAS replicas..."

kubectl scale deployment "$DEPLOYMENT_NAME" --replicas="$REPLICAS" -n "$NAMESPACE"
