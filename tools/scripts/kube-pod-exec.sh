#!/bin/bash
set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/kube-selection.bash"

################################################################################
# kube-pod-exec.sh
#
# Execute a command in a Kubernetes pod
#
# Usage:
#   ./kube-pod-exec.sh <pod-name-part> [-n|--namespace <ns>] <command>...
#
# Namespace resolution: -n/--namespace flag > NAMESPACE env var > partial-match
# > interactive fzf picker (TTY) > current-context default (non-TTY).
#
# Environment Variables:
#   NAMESPACE - Kubernetes namespace (optional; overridden by the flag)
#
# Dependencies:
#   - kubectl
#
################################################################################

argv=("$@")
POD_NAME_PART="${1:?usage: kube-pod-exec.sh <pod-name-part> [-n|--namespace <ns>] <command>... }"
shift

# Namespace resolution: flag > env > partial match > picker > context default.
parse_namespace_flag argv || true
NS=$(resolve_namespace "${NAMESPACE_FLAG_VALUE:-}")

# Remaining args (after flag extraction) are the command; first is the pod filter.
POD_NAME_PART="${argv[0]}"
COMMAND=("${argv[@]:1}")

# Find matching pods
POD_NAME=$(NAMESPACE="$NS" kube-pod-select.sh "$POD_NAME_PART")

# Check if a pod was found
if [ -z "$POD_NAME" ]; then
    echo "No matching pod found for pattern: $POD_NAME_PART"
    exit 1
fi

echo "Executing command for pod: $POD_NAME in namespace: $NS"
kubectl exec "$POD_NAME" -n "$NS" -- "${COMMAND[@]}"
