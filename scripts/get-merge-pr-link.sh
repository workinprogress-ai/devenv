#!/bin/bash

# Set the repository folder to the first argument or default to the current directory
repo_folder=${1:-.}

# Navigate to the repository folder
cd "$repo_folder" || { echo "Invalid repository folder: $repo_folder"; exit 1; }

# Get the current branch name
current_branch=$(git rev-parse --abbrev-ref HEAD)

# Check if there is an open PR for the current branch
pr_url=$(gh pr view --web --head "$current_branch" 2>/dev/null)

if [ $? -ne 0 ]; then
  echo "No open merge PR found for the branch '$current_branch'."
  exit 1
fi

# If a PR is found, it will already be opened in the browser by the `gh pr view --web` command
echo "$pr_url"
