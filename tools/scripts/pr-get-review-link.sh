#!/bin/bash

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
cd "$REPO_DIR" || { echo "Invalid repository folder: $REPO_DIR" >&2; exit 1; }

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Directory $REPO_DIR is not a git repository." >&2; exit 1; }

# Get repo spec
read -ra repo_spec <<< "$(get_repo_spec)"

# Prefer REVIEW-titled PRs, then any PR with review/ in the head
pr_url=$(gh pr list "${repo_spec[@]}" --state open --search "REVIEW:" --json title,url --jq '.[] | select(.title | startswith("REVIEW:")) | .url' | head -n 1)

if [ -z "$pr_url" ]; then
  pr_url=$(gh pr list "${repo_spec[@]}" --state open --search "head:review/" --json url --jq '.[0].url' 2>/dev/null || true)
fi

if [ -z "$pr_url" ]; then
  echo "No open review PRs found." >&2
  exit 1
fi

echo "$pr_url"