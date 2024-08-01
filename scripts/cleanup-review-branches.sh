#!/bin/bash

# Function to explode if something goes wrong
explode() {
  echo "Error: $1"
  exit 1
}

# Check if repo folder is supplied as an argument, otherwise use the current directory
REPO_DIR="${1:-$(pwd)}"

# Check if the given directory is a git repository
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  explode "Directory $REPO_DIR is not a git repository."
fi

cd "$REPO_DIR"

# Fetch the latest branches from the remote
git fetch origin || explode "Failed to fetch branches from the remote."

# Find all local branches that start with "review/"
REVIEW_BRANCHES=$(git branch --list "review/*")

if [ -z "$REVIEW_BRANCHES" ]; then
  echo "No review branches found."
  exit 0
fi

echo "Found review branches:"
echo "$REVIEW_BRANCHES"

# Delete each review branch locally and remotely
for BRANCH in $REVIEW_BRANCHES; do
  # Trim whitespace
  BRANCH=$(echo $BRANCH | xargs)
  
  # Delete local branch
  git branch -D "$BRANCH" || explode "Failed to delete local branch $BRANCH"
  echo "Deleted local branch $BRANCH"
  
  # Delete remote branch
  git push origin --delete "$BRANCH" || explode "Failed to delete remote branch $BRANCH"
  echo "Deleted remote branch $BRANCH"
done

echo "All review branches have been deleted."
