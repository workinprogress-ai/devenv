#!/bin/bash
set -euo pipefail

if [ -f "$DEVENV_ROOT/tools/lib/github-helpers.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/github-helpers.bash"
fi

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