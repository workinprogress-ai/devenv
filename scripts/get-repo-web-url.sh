#!/bin/bash

# Set the repository folder to the first argument or default to the current directory
REPO_DIR="${1:-$(pwd)}"
cd "$REPO_DIR" || { echo "Invalid repository folder: $REPO_DIR"; exit 1; }

# Ensure the current directory is a git repository
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "Directory $REPO_DIR is not a git repository."
  exit 1
fi

# Extract the remote URL
remote_url=$(git config --get remote.origin.url)

# Check if the remote URL matches GitHub patterns
if [[ $remote_url =~ github.com ]]; then
  # SSH URL format: git@github.com:owner/repository.git or HTTPS URL format: https://github.com/owner/repository.git
  repo_url=$(echo "$remote_url" | sed -E 's#(git@|https://)([^:/]+)[:/]([^/]+)/([^/]+).git#https://\2/\3/\4#')
else
  echo "Not a GitHub repository."
  exit 1
fi

# Open the repository page in the default browser
echo "$repo_url"
