#!/bin/bash
set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/kube-selection.bash"

# Ensure a search string is provided
if [ -z "${1:-}" ]; then
    echo "Usage: $0 <partial-pod-name> [-n|--namespace <ns>]"
    echo "  (legacy form: <partial-pod-name> <namespace> also works)"
    echo "Environment: YES=1 skips the confirmation prompt."
    exit "$EXIT_MISUSE"
fi

# shellcheck disable=SC2034  # argv is consumed via nameref by parse_namespace_flag
argv=("$@")
POD_NAME_PART="$1"
LEGACY_NS="${2:-}"
shift

# Backward compat: a bare second positional is treated as the namespace.
parse_namespace_flag argv || true
NAMESPACE="${NAMESPACE_FLAG_VALUE:-$LEGACY_NS}"

NAMESPACE=$(resolve_namespace "$NAMESPACE")

# Resolve the name fragment to exactly one pod: refuses on zero matches and on
# multiple matches (candidates listed) so a partial name can never delete an
# unintended pod.
POD_NAME=$(resolve_single_match list_pods --filter "$POD_NAME_PART" --namespace "$NAMESPACE") || {
    rc=$?
    exit "$rc"
}

confirm_or_fail "Delete pod '$POD_NAME' in namespace $NAMESPACE"

echo "Deleting pod: $POD_NAME"

kubectl delete pod "$POD_NAME" -n "$NAMESPACE"
