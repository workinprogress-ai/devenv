#!/bin/bash

# Function to explode if something goes wrong
explode() {
  echo "Error: $1"
  exit 1
}

# Check if the number of days is supplied as an argument
if [ -z "$2" ]; then
  echo "Usage: $0 [repo-directory] [number-of-days]"
  echo
fi

# Check if repo folder is supplied as an argument, otherwise use the current directory
REPO_DIR="${1:-$(pwd)}"

DAYS="${2:-30}"

# Check if the given directory is a git repository
if ! git -C "$REPO_DIR" rev-parse --is-inside-work-tree &>/dev/null; then
  explode "Directory $REPO_DIR is not a git repository."
fi

cd "$REPO_DIR" || explode "Failed to change to repository directory $REPO_DIR."

# Fetch the latest branches from the remote
git fetch origin || explode "Failed to fetch branches from the remote."

# Find all local branches that start with "review/"
REVIEW_BRANCHES=$(git branch -r --list "origin/review/*")

if [ -z "$REVIEW_BRANCHES" ]; then
  echo "No review branches found."
  exit 0
fi

echo "Found review branches:"
echo "$REVIEW_BRANCHES"

# Get the current date in seconds since the epoch
CURRENT_DATE=$(date +%s)

# Delete each review branch locally and remotely if it's older than the specified number of days
for BRANCH in $REVIEW_BRANCHES; do
  # Trim whitespace
  BRANCH=$(echo $BRANCH | xargs)
  BRANCH="${BRANCH#origin/}"
  
  # Extract the date from the branch name (assuming the format review/abcdefg-YY-MM-DD-source or review/abcdefg-YY-MM-DD-target)
  BRANCH_DATE=$(echo "$BRANCH" | grep -oE '[0-9]{2}-[0-9]{2}-[0-9]{2}')
  
  if [ -z "$BRANCH_DATE" ]; then
    echo "Skipping branch $BRANCH; no valid date found in branch name."
    continue
  fi
  
  # Convert the extracted date (YY-MM-DD) to YYYY-MM-DD format
  BRANCH_DATE_FULL="20${BRANCH_DATE:0:2}-${BRANCH_DATE:3:2}-${BRANCH_DATE:6:2}"
  
  # Convert the branch date to seconds since the epoch
  BRANCH_DATE_EPOCH=$(date -d "$BRANCH_DATE_FULL" +%s)
  
  # Calculate the difference in days between the current date and the branch date
  DIFF_DAYS=$(( (CURRENT_DATE - BRANCH_DATE_EPOCH) / 86400 ))
  
  # Only delete the branch if it's older than the specified number of days
  if [ "$DIFF_DAYS" -ge "$DAYS" ]; then
    # Delete remote branch
    git push origin --delete "$BRANCH" || explode "Failed to delete remote branch $BRANCH"
    echo "Deleted remote branch $BRANCH"
  else
    echo "Skipping branch $BRANCH, last updated $DIFF_DAYS days ago."
  fi
done

echo "Review branch cleanup completed."
