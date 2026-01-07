#!/bin/bash

################################################################################
# pr-cleanup-review-branches.sh
#
# Clean up old review branches from the repository
#
# Usage:
#   ./pr-cleanup-review-branches.sh [repo-directory] [days-old]
#
# Arguments:
#   repo-directory - Path to repository (default: current directory)
#   days-old - Remove branches older than this many days (default: 30)
#
# Dependencies:
#   - git
#   - git-operations.bash
#
################################################################################

set -euo pipefail
source "$DEVENV_TOOLS/lib/git-operations.bash"



explode() {
  echo "Error: $1" >&2
  exit 1
}

REPO_DIR="${1:-$(pwd)}"
DAYS="${2:-30}"

# Validate git context using library function
if ! validate_git_context "$REPO_DIR"; then
  explode "Invalid git context: $REPO_DIR is not a valid git repository"
fi

cd "$REPO_DIR" || explode "Failed to change to repository directory $REPO_DIR."

git fetch origin || explode "Failed to fetch branches from the remote."

REVIEW_BRANCHES=$(git branch -r --list "origin/review/*")
if [ -z "$REVIEW_BRANCHES" ]; then
  echo "No review branches found."
  exit 0
fi

echo "Found review branches:"
echo "$REVIEW_BRANCHES"

CURRENT_DATE=$(date +%s)

for BRANCH in $REVIEW_BRANCHES; do
  BRANCH=$(echo "$BRANCH" | xargs)
  BRANCH="${BRANCH#origin/}"

  BRANCH_DATE=$(echo "$BRANCH" | grep -oE '[0-9]{2}-[0-9]{2}-[0-9]{2}')
  if [ -z "$BRANCH_DATE" ]; then
    echo "Skipping branch $BRANCH; no valid date found in branch name."
    continue
  fi

  BRANCH_DATE_FULL="20${BRANCH_DATE:0:2}-${BRANCH_DATE:3:2}-${BRANCH_DATE:6:2}"
  BRANCH_DATE_EPOCH=$(date -d "$BRANCH_DATE_FULL" +%s)
  DIFF_DAYS=$(((CURRENT_DATE - BRANCH_DATE_EPOCH) / 86400))

  if [ "$DIFF_DAYS" -ge "$DAYS" ]; then
    delete_branch "$BRANCH" origin || explode "Failed to delete remote branch $BRANCH"
    echo "Deleted remote branch $BRANCH"
  else
    echo "Skipping branch $BRANCH, last updated $DIFF_DAYS days ago."
  fi
done

echo "Review branch cleanup completed."