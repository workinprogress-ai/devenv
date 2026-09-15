#!/bin/bash
set -euo pipefail
# Self-derive the tools root when DEVENV_TOOLS is not exported (set -u makes a bare deref fatal).
DEVENV_TOOLS="${DEVENV_TOOLS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$DEVENV_TOOLS/lib/error-handling.bash"

# Optional search string for pod filtering
POD_NAME_PART="$1"
NAMESPACE_OPTION=""

if [ -n "${NAMESPACE:-}" ]; then
    NAMESPACE_OPTION="-n $NAMESPACE"
fi

# Get the list of pod names
if [ -n "$POD_NAME_PART" ]; then
    kubectl get pods $NAMESPACE_OPTION -o json | jq -r ".items[].metadata.name | select(test(\"$POD_NAME_PART\"))"
else
    kubectl get pods $NAMESPACE_OPTION -o json | jq -r ".items[].metadata.name"
fi
