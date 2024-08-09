#!/bin/bash

# Function to explode if something goes wrong
explode() {
  echo "Error: $1"
  if [ -n "$NEW_BRANCH" ] && [ -n "$CURRENT_BRANCH" ] ; then
    git checkout "$CURRENT_BRANCH" &>/dev/null
    git push origin :$NEW_BRANCH &>/dev/null
    git branch -D "$NEW_BRANCH" &>/dev/null
  fi
  cd - &>/dev/null
  exit 1
}

# Check if repo folder is supplied as an argument, otherwise use the current directory
REPO_DIR="${1:-$(pwd)}"
cd "$REPO_DIR"

# Check if the given directory is a git repository
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  explode "Directory $REPO_DIR is not a git repository."
fi

# Check for uncommitted or staged changes
if ! git diff-index --quiet HEAD --; then
  explode "There are uncommitted or staged changes in the current branch."
fi

# Check if we are on the master branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" == "review/"* ]; then
  explode "This script cannot be run on a review branch."
fi

PARENT_COMMIT="$2"
if [ -z "$PARENT_COMMIT" ]; then
  versions=$(list-versions.sh)

  # If there are no versions, exit
  if [ -z "$versions" ]; then
    explode "No version tags found in the repository."
  fi

  selected=$(echo "$versions" | fzf --ansi --no-sort --tac --prompt="Select a version: " --height=40%)

  # If the user made a selection, extract the short hash
  if [ -n "$selected" ]; then
    short_hash=$(echo "$selected" | awk '{print $5}')  # Assumes short hash is the 5th column

    # Get the full commit hash using the short hash
    PARENT_COMMIT=$(git rev-parse "$short_hash")
  else
    explode "Could not determine parent commit.  Please specify it as the second argument or select it from the list."
  fi
fi

# Create a new branch from the parent commit
NEW_BRANCH="review/$(uuid)"
git checkout -b "$NEW_BRANCH" "$PARENT_COMMIT" || explode "Failed to create new branch $NEW_BRANCH"

# Push the new branch to the remote
git push origin "$NEW_BRANCH" || explode "Failed to push new branch $NEW_BRANCH"

# Create a draft pull request using GitHub CLI
PR_TITLE="REVIEW: $CURRENT_BRANCH"
PR_BODY="Review changes from $CURRENT_BRANCH to $NEW_BRANCH"
PR_CMD_RET=$(gh pr create --title "$PR_TITLE" --body "$PR_BODY" --base "$NEW_BRANCH" --head "$CURRENT_BRANCH" --draft --assignee @me) || explode "Failed to create pull request"

git checkout "$CURRENT_BRANCH" || explode "Failed to switch back to the current branch"

git push origin :$NEW_BRANCH || explode "Failed to remove the review branch $NEW_BRANCH"
git branch -D "$NEW_BRANCH" || explode "Failed to delete the review branch $NEW_BRANCH"

# Output the PR URL
echo url=$(echo "$PR_CMD_RET" | grep -oP '(?<=Pull Request URL: ).*')
