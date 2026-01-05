#!/bin/bash
set -euo pipefail

if [ -f "$DEVENV_ROOT/tools/lib/github-helpers.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/github-helpers.bash"
fi

if [ -f "$DEVENV_ROOT/tools/lib/issue-operations.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
fi

REPO_DIR="${1:-$(pwd)}"
cd "$REPO_DIR" || { echo "Invalid repository folder: $REPO_DIR" >&2; exit 1; }

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Directory $REPO_DIR is not a git repository." >&2; exit 1; }

# Get repo spec
read -ra repo_spec <<< "$(get_repo_spec)"

current_branch=$(git rev-parse --abbrev-ref HEAD)
pr_url=$(gh pr list "${repo_spec[@]}" --state open --head "$current_branch" --json url --jq '.[0].url' 2>/dev/null || true)

if [ -z "$pr_url" ]; then
  echo "No open PR found for branch '$current_branch'." >&2
  exit 1
fi

echo "$pr_url"