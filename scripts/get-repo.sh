#!/bin/bash

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")
repos_dir=$toolbox_root/repos

# Function to display usage
usage() {
  echo "Usage: $0 <repository-name>"
}

configure_git() {
    local CURRENT_DIR="$(pwd)"

    # Check if the directory is already in the safe.directory list
    if ! git config --global --get-all safe.directory | grep -Fxq "$CURRENT_DIR"; then
        # Add the current directory to the safe list
        git config --global --add safe.directory "$CURRENT_DIR"
    fi    
    git config core.autocrlf false
    git config core.eol lf
    git config pull.ff only
    git remote set-url origin "$GIT_URL"
}

if [ -z "$1" ]; then
  usage  
  REPO_NAME=$(basename `git rev-parse --show-toplevel`)
  if [ $? -ne 0 ]; then
    echo "Failed to get the repository name. Please provide the repository name as an argument."
    exit 1
  fi
  if [ ! -d "$repos_dir/$REPO_NAME" ]; then
    echo "Repository '$REPO_NAME' does not exist in the local repository directory."
    exit 1
  fi
else
    REPO_NAME=${1%/}
fi

TARGET_DIR=$repos_dir/$REPO_NAME
GIT_URL_PREFIX="https://${GITHUB_USER}:${DEVENV_GH_TOKEN}@github.com/workinprogress-ai/"
GIT_URL="${GIT_URL_PREFIX}/${REPO_NAME}.git"

# Check if the target directory exists
if [ -d "$TARGET_DIR" ]; then
    echo "Repository '$REPO_NAME' already exists. Fetching latest changes..."
    cd "$TARGET_DIR"
    configure_git
    git fetch --all --tags -f

    current_branch=$(git rev-parse --abbrev-ref HEAD)
    if [ "$current_branch" != "master" ]; then
        git branch -f master origin/master   # Update the local master branch
        git pull --rebase                    # update this branch
        if [ $? -ne 0 ]; then
            echo "Failed to update repository in '$repo' for branch '$current_branch'."
        else
            echo "Repository in '$repo' updated successfully."
            update=".repo/update.sh"
            if [ -f "$update" ]; then
                echo "=> Running update script for $repo_name..."
                $update
            fi
        fi
    else
        git reset --hard origin/master
    fi

    update=".repo/update.sh"
    if [ -f "$update" ]; then
        echo "=> Running update script for $repo_name..."
        $update
    fi
    #git pull --all
    cd - &>/dev/null
else
    echo "Repository '$REPO_NAME' does not exist. Attempting to clone..."
    git clone "$GIT_URL" "$TARGET_DIR"
    if [ $? -ne 0 ]; then
        echo "Failed to clone repository '$REPO_NAME'. Please check the repository name and try again."
        exit 1
    fi
    cd "$TARGET_DIR"
    configure_git
    git fetch --all --tags -f

    init=".repo/init.sh"
    if [ -f "$init" ]; then
        echo "=> Running init script for $repo_name..."
        $init
    fi
fi
echo "Operation completed successfully."
