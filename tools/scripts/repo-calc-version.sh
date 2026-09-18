#!/usr/bin/env bash

################################################################################
# repo-calc-version.sh
#
# Calculate the next version for the repository
#
# Usage:
#   ./repo-calc-version.sh
#
# Output:
#   Outputs the calculated next version string
#
# Dependencies:
#   - error-handling.bash
#   - release-operations.bash
#
################################################################################

set -euo pipefail
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/release-operations.bash"

# == Main ==
latest_tag="$(get_latest_version_tag || true)"
next_version="$(calculate_next_version "${latest_tag:-}")"
echo "$next_version"
