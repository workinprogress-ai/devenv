#!/bin/bash

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")
repos_dir=$toolbox_root/repos

# Check if the target directory exists
if [ ! -d "$repos_dir" ]; then
  echo "Target directory '$repos_dir' does not exist. Please check the path and try again."
  exit 1
fi

# Loop through each directory in the target directory
for repo in "$repos_dir"/*; do
    if [ -d "$repo" ] && [ -d "$repo/.git" ]; then
        echo "Updating repository in '$repo'..."
        cd "$repo" 
        git fetch --all --tags
        git update-ref refs/heads/master origin/master      # Update the local master branch
        git pull --rebase
        if [ $? -ne 0 ]; then
            echo "Failed to update repository in '$repo'."
        else
            echo "Repository in '$repo' updated successfully."
        fi

        update=".repo/update.sh"
        if [ -f "$update" ]; then
            echo "=> Running update script for $repo_name..."
            $update
        fi
        cd - &>/dev/null
    fi
done

echo "All repositories processed."
