#!/bin/bash
set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

################################################################################
# kube-pod-console.sh
#
# Open an interactive console/shell to a Kubernetes pod
#
# Usage:
#   ./kube-pod-console.sh <pod-name-part> [-n|--namespace <ns>] [command...]
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


# shellcheck disable=SC2034  # argv is consumed via nameref by parse_namespace_flag
argv=("$@")
POD_NAME_PART="$1"

shift

parse_namespace_flag argv || true
NAMESPACE=$(resolve_namespace "${NAMESPACE_FLAG_VALUE:-${NAMESPACE:-}}")

# Find matching pod using library function
POD_NAME=$(list_pods --namespace "$NAMESPACE" --filter "$POD_NAME_PART" | head -n 1)

# Check if a pod was found
if [ -z "$POD_NAME" ]; then
    echo "No matching pod found for pattern: $POD_NAME_PART"
    exit 1
fi

if [ $# -eq 0 ]; then
    echo "No command provided to execute on the pod.  Executing /bin/bash by default."
    set -- /bin/bash
fi
echo "Executing command on console for pod: $POD_NAME in namespace: $NAMESPACE"

kubectl exec -it "$POD_NAME" -n "$NAMESPACE" -- "$@"
