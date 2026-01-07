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

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/release-operations.bash"

# == Main ==
latest_tag="$(get_latest_version_tag || true)"
next_version="$(calculate_next_version "${latest_tag:-}")"
echo "$next_version"
