#!/bin/bash
set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/kube-selection.bash"

# Optional search string for pod filtering
# shellcheck disable=SC2034  # argv is consumed via nameref by parse_namespace_flag
argv=("$@")

# Namespace resolution: -n/--namespace flag > NAMESPACE env > partial match >
# picker (TTY) > current-context default (non-TTY).
parse_namespace_flag argv || true
NS=$(resolve_namespace "${NAMESPACE_FLAG_VALUE:-}")

# The filter is what is left once -n/--namespace has been stripped; reading $1
# before that would take the flag itself ("-n") for the filter.
POD_NAME_PART="${argv[0]:-}"

# Get the list of pod names
if [ -n "$POD_NAME_PART" ]; then
    kubectl get pods -n "$NS" -o json | jq -r ".items[].metadata.name | select(test(\"$POD_NAME_PART\"))"
else
    kubectl get pods -n "$NS" -o json | jq -r ".items[].metadata.name"
fi
