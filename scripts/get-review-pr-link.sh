#!/bin/bash

# Set the repository folder to the first argument or default to the current directory
REPO_DIR="${1:-$(pwd)}"
cd "$REPO_DIR" || { echo "Invalid repository folder: $REPO_DIR"; exit 1; }

# Ensure the current directory is a git repository
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "Directory $REPO_DIR is not a git repository."
  exit 1
fi

# Step 1: Try to find an open PR with "REVIEW:" in the title
pr_info=$(gh pr list --state open --search "REVIEW:" --json number,url --jq '.[] | select(.title | startswith("REVIEW:")) | .url' | head -n 1)

if [ -n "$pr_info" ]; then
  echo "$pr_info"
else
  # Step 2: If no PR found with "REVIEW:" in the title, search for a PR with "review/" in the branch name
  pr_info=$(gh pr list --state open --search "head:review/" --json number,url --jq '.[0].url')

  if [ -n "$pr_info" ]; then
    echo "$pr_info"
  else
    echo "No open review PRs found."
  fi
fi
