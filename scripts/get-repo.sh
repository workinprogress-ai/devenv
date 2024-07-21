#!/bin/bash

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")
repos_dir=$toolbox_root/repos

# Function to display usage
usage() {
  echo "Usage: $0 <repository-name>"
  exit 1
}

# Check if a parameter is passed
if [ -z "$1" ]; then
  usage
fi

REPO_NAME=$1
TARGET_DIR=$repos_dir/$REPO_NAME
GIT_URL_PREFIX="git@github.com:workinprogress-ai"

# Check if the target directory exists
if [ -d "$TARGET_DIR" ]; then
    echo "Repository '$REPO_NAME' already exists. Fetching latest changes..."
    cd "$TARGET_DIR"
    git fetch --all --tags
    git update-ref refs/heads/master origin/master      # Update the local master branch
    update=".repo/update.sh"
    if [ -f "$update" ]; then
        echo "=> Running update script for $repo_name..."
        $update
    fi
    #git pull --all
    cd - &>/dev/null
else
    echo "Repository '$REPO_NAME' does not exist. Attempting to clone..."
    GIT_URL="${GIT_URL_PREFIX}/${REPO_NAME}.git"
    git clone "$GIT_URL" "$TARGET_DIR"
    if [ $? -ne 0 ]; then
        echo "Failed to clone repository '$REPO_NAME'. Please check the repository name and try again."
        exit 1
    fi
    cd "$TARGET_DIR"
    git fetch --tags
    init=".repo/init.sh"
    if [ -f "$init" ]; then
        echo "=> Running init script for $repo_name..."
        $init
    fi
fi
echo "Operation completed successfully."
