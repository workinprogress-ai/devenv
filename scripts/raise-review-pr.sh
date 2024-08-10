#!/bin/bash

# Function to explode if something goes wrong
explode() {
  echo "Error: $1"
  git checkout "$CURRENT_BRANCH" &>/dev/null
  if [ -n "$TARGET_BRANCH" ] ; then
    git push origin :$TARGET_BRANCH &>/dev/null
    git branch -D "$TARGET_BRANCH" &>/dev/null
  fi
  if [ -n "$SOURCE_BRANCH" ] ; then
    git push origin :$SOURCE_BRANCH &>/dev/null
    git branch -D "$SOURCE_BRANCH" &>/dev/null
  fi
  cd - &>/dev/null
  exit 1
}

random_name() {
  echo $(uuid | cut -c1-8)
}

select_commit() {
  prompt="$1"

  # If there are no versions, exit
  if [ -z "$versions" ]; then
    explode "No version tags found in the repository."
  fi

  local selected=$(echo "$versions" | fzf --ansi --no-sort --tac --prompt="$1" --height=40%)

  # If the user made a selection, extract the short hash
  if [ -n "$selected" ]; then
    short_hash=$(echo "$selected" | awk '{print $5}')  # Assumes short hash is the 5th column

    # Get the full commit hash using the short hash
    echo $(git rev-parse "$short_hash")
  else
    explode "Could not determine commit."
  fi
}

PR_DESCRIPTION="$1"
if [ -z "$PR_DESCRIPTION" ]; then
  echo "Usage: raise-review-pr.sh <PR_DESCRIPTION> [REPO_DIR] [FIRST_COMMIT] [FINAL_COMMIT]"
  exit 1
fi

# Check if repo folder is supplied as an argument, otherwise use the current directory
REPO_DIR="${2:-$(pwd)}"
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

versions=$(list-versions.sh)

FIRST_COMMIT="$3"
if [ -z "$FIRST_COMMIT" ]; then
  clear
  echo
  echo "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^"
  echo "Please select the FROM commit to compare.  This is the FIRST one."
  echo "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^"
  echo
  FIRST_COMMIT=$(select_commit "Select the FROM commit: ")
  clear
fi

FINAL_COMMIT="$4"
if [ -z "$FINAL_COMMIT" ]; then
  clear
  echo
  echo "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^"
  echo "Please select the TO commit to compare.  This is the LAST one."
  echo "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^"
  echo
  FINAL_COMMIT=$(select_commit "Select the TO commit: ")
  clear
fi

PARENT_COMMIT=$(git rev-parse "${FIRST_COMMIT}^") || explode "Failed to get the parent commit $FIRST_COMMIT"

# Create a new branch from the parent commit
BRANCH_BASE_NAME="review/$(random_name)"
TARGET_BRANCH="$BRANCH_BASE_NAME-target"
SOURCE_BRANCH="$BRANCH_BASE_NAME-source"

git checkout -b "$TARGET_BRANCH" "$PARENT_COMMIT" || explode "Failed to create new branch $TARGET_BRANCH"
git push origin "$TARGET_BRANCH" || explode "Failed to push new branch $TARGET_BRANCH"

git checkout -b "$SOURCE_BRANCH" "$FINAL_COMMIT" || explode "Failed to create new branch $SOURCE_BRANCH"
git push origin "$SOURCE_BRANCH" || explode "Failed to push new branch $TARGET_BRANCH"

# Create a draft pull request using GitHub CLI
PR_TITLE="REVIEW: $PR_DESCRIPTION"
PR_BODY="$PR_DESCRIPTION"
PR_CMD_RET=$(gh pr create --title "$PR_TITLE" --body "$PR_BODY" --base "$TARGET_BRANCH" --head "$SOURCE_BRANCH" --draft --assignee @me) || explode "Failed to create pull request"

git checkout "$CURRENT_BRANCH" &>/dev/null || explode "Failed to switch back to the current branch"
git push origin :$TARGET_BRANCH || explode "Failed to remove the review branch $TARGET_BRANCH"
git branch -D "$TARGET_BRANCH" &>/dev/null || explode "Failed to delete the review branch $TARGET_BRANCH"
git push origin :$SOURCE_BRANCH || explode "Failed to remove the review branch $SOURCE_BRANCH"
git branch -D "$SOURCE_BRANCH" &>/dev/null || explode "Failed to delete the review branch $SOURCE_BRANCH"

# Output the PR URL
echo $PR_CMD_RET
#echo $(echo "$PR_CMD_RET" | grep -oP '(?<=Pull Request URL: ).*')
