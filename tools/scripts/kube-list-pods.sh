#!/bin/bash
set -euo pipefail
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/kube-selection.bash"

# Optional search string for pod filtering
# shellcheck disable=SC2034  # argv is consumed via nameref by parse_namespace_flag
argv=("$@")
POD_NAME_PART="${1:-}"
shift 2>/dev/null || true

# Namespace resolution: -n/--namespace flag > NAMESPACE env > partial match >
# picker (TTY) > current-context default (non-TTY).
parse_namespace_flag argv || true
NS=$(resolve_namespace "${NAMESPACE_FLAG_VALUE:-}")

# Get the list of pod names
if [ -n "$POD_NAME_PART" ]; then
    kubectl get pods -n "$NS" -o json | jq -r ".items[].metadata.name | select(test(\"$POD_NAME_PART\"))"
else
    kubectl get pods -n "$NS" -o json | jq -r ".items[].metadata.name"
fi
