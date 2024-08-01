#!/bin/bash

# Function to explode if something goes wrong
explode() {
  echo "Error: $1"
  exit 1
}

# Check if repo folder is supplied as an argument, otherwise use the current directory
REPO_DIR="${1:-$(pwd)}"

# Check if the given directory is a git repository
if [ ! -d "$REPO_DIR/.git" ]; then
  explode "Directory $REPO_DIR is not a git repository."
fi

cd "$REPO_DIR"

# Check for uncommitted or staged changes
if ! git diff-index --quiet HEAD --; then
  explode "There are uncommitted or staged changes in the current branch."
fi

# Check for unpushed changes
# if [ "$(git cherry -v)" != "" ]; then
#   explode "There are unpushed changes in the current branch."
# fi
# exit 0;

# Check if we are on the master branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" == "master" ]; then
  explode "This script cannot be run on the master branch."
fi
if [ "$CURRENT_BRANCH" == "review/"* ]; then
  explode "This script cannot be run on a review branch."
fi

# Find the parent commit where the branch was cut from master
PARENT_COMMIT=$(git merge-base master "$CURRENT_BRANCH")

# Create a new branch from the parent commit
NEW_BRANCH="review/$CURRENT_BRANCH"
git checkout -b "$NEW_BRANCH" "$PARENT_COMMIT" || explode "Failed to create new branch $NEW_BRANCH"

# Push the new branch to the remote
git push origin "$NEW_BRANCH" || explode "Failed to push new branch $NEW_BRANCH"

# Create a draft pull request using GitHub CLI
PR_TITLE="REVIEW: $CURRENT_BRANCH"
PR_BODY="Review changes from $CURRENT_BRANCH to $NEW_BRANCH"
PR_URL=$(gh pr create --title "$PR_TITLE" --body "$PR_BODY" --base "$NEW_BRANCH" --head "$CURRENT_BRANCH" --draft --assignee @me) || explode "Failed to create pull request"

git checkout "$CURRENT_BRANCH" || explode "Failed to switch back to the current branch"

# Output the PR URL
echo "Pull Request URL: $PR_URL"
