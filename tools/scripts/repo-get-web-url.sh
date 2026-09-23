#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"

################################################################################
# repo-get-web-url.sh
#
# Get the web URL for a repository
#
# Usage:
#   ./repo-get-web-url.sh [repository-directory]
#
# Arguments:
#   repository-directory - Path to repository (default: current directory)
#
# Output:
#   Outputs the web URL of the repository (normalizes SSH to HTTPS)
#
# Dependencies:
#   - git
#
################################################################################

set -euo pipefail

REPO_DIR="${1:-$(pwd)}"
cd "$REPO_DIR" || { echo "Invalid repository folder: $REPO_DIR" >&2; exit 1; }

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "Directory $REPO_DIR is not a git repository." >&2
  exit 1
fi

remote_url=$(git config --get remote.origin.url)

# Host detection + normalization via the provider URL seam.
if repo_url=$(provider_remote_to_web "$remote_url"); then
  echo "$repo_url"
else
  echo "Not a GitHub repository." >&2
  exit 1
fi