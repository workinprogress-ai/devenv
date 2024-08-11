#!/bin/bash

# Function to explode if something goes wrong
explode() {
  echo "Error: $1"
  exit 1
}

PR_TITLE="$1"
if [ -z "$PR_TITLE" ]; then
  echo "Usage: raise-review-pr.sh <Title> [REPO_DIR]"
  exit 1
fi

# Check if repo folder is supplied as an argument, otherwise use the current directory
REPO_DIR="${2:-$(pwd)}"

# Check if the given directory is a git repository
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  explode "Directory $REPO_DIR is not a git repository."
fi

cd "$REPO_DIR"

# Check for uncommitted or staged changes
if ! git diff-index --quiet HEAD --; then
  explode "There are uncommitted or staged changes in the current branch."
fi

# Check if we are on the master branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" == "master" ]; then
  explode "This script cannot be run on the master branch."
fi
if [ "$CURRENT_BRANCH" == "review/"* ]; then
  explode "This script cannot be run on a review branch."
fi

# Create a draft pull request using GitHub CLI
PR_CMD_RET=$(gh pr create --title "$PR_TITLE" --body "" --base "$CURRENT_BRANCH" --head "master" --draft --assignee @me) || explode "Failed to create pull request"

# Output the PR URL
echo url=$(echo "$PR_CMD_RET" | grep -oP '(?<=Pull Request URL: ).*')
