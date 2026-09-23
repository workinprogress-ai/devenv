#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"

################################################################################
# pr-get-merge-link.sh
#
# Get the merge link for the current branch's pull request
#
# Usage:
#   ./pr-get-merge-link.sh [repository-directory]
#
# Arguments:
#   repository-directory - Path to repository (default: current directory)
#
# Dependencies:
#   - git
#   - gh (GitHub CLI)
#   - provider-loader.bash
#   - issue-operations.bash
#
################################################################################

set -euo pipefail
source "$DEVENV_TOOLS/lib/provider-loader.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"




REPO_DIR="${1:-$(pwd)}"
cd "$REPO_DIR" || { echo "Invalid repository folder: $REPO_DIR" >&2; exit "$EXIT_GENERAL_ERROR"; }

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Directory $REPO_DIR is not a git repository." >&2; exit "$EXIT_GENERAL_ERROR"; }

# Get repo spec
read -ra repo_spec <<< "$(get_repo_spec)"

current_branch=$(git rev-parse --abbrev-ref HEAD)
pr_url=$(provider_prs_list "${repo_spec[1]:-}" --state open --head "$current_branch" --json url --jq '.[0].url' 2>/dev/null || true)

if [ -z "$pr_url" ]; then
  echo "No open PR found for branch '$current_branch'." >&2
  exit $EXIT_API_FAILURE
fi

echo "$pr_url"