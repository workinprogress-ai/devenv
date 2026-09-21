#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"

################################################################################
# pr-get-review-link.sh
#
# Get the review link for the current branch's pull request
#
# Usage:
#   ./pr-get-review-link.sh [repository-directory]
#
# Arguments:
#   repository-directory - Path to repository (default: current directory)
#
# Dependencies:
#   - git
#   - gh (GitHub CLI)
#   - github-helpers.bash
#   - issue-operations.bash
#
################################################################################

set -euo pipefail
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

show_usage() {
  cat << 'EOF'
Usage: pr-get-review-link [REPO_DIR]

Get the GitHub URL for an open "REVIEW:" pull request in the repository.
Falls back to any open PR with a head branch under review/.

Arguments:
    REPO_DIR    Repository path (default: current directory)

Options:
    -h, --help  Show this help and exit
EOF
  exit 0
}

case "${1:-}" in
  -h|--help) show_usage ;;
esac




REPO_DIR="${1:-$(pwd)}"
cd "$REPO_DIR" || { echo "Invalid repository folder: $REPO_DIR" >&2; exit "$EXIT_GENERAL_ERROR"; }

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Directory $REPO_DIR is not a git repository." >&2; exit "$EXIT_GENERAL_ERROR"; }

# Get repo spec
read -ra repo_spec <<< "$(get_repo_spec)"

# Prefer REVIEW-titled PRs, then any PR with review/ in the head
pr_url=$(provider_prs_list "${repo_spec[1]:-}" --state open --search "REVIEW:" --json title,url --jq '.[] | select(.title | startswith("REVIEW:")) | .url' | head -n 1)

if [ -z "$pr_url" ]; then
  pr_url=$(provider_prs_list "${repo_spec[1]:-}" --state open --search "head:review/" --json url --jq '.[0].url' 2>/dev/null || true)
fi

if [ -z "$pr_url" ]; then
  echo "No open review PRs found." >&2
  exit $EXIT_API_FAILURE
fi

echo "$pr_url"