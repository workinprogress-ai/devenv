#!/bin/bash

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")
repos_dir=$toolbox_root/repos

# Function to display usage
usage() {
  echo "Usage: $0 <repository-name>"
}

REPO_NAME=$1
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
fi

TARGET_DIR=$repos_dir/$REPO_NAME
GIT_URL_PREFIX="git@github.com:workinprogress-ai"

# Check if the target directory exists
if [ -d "$TARGET_DIR" ]; then
    echo "Repository '$REPO_NAME' already exists. Fetching latest changes..."
    cd "$TARGET_DIR"
    git fetch --all --tags -f
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

    git config core.autocrlf false
    git config core.eol lf
    git config pull.ff only

    init=".repo/init.sh"
    if [ -f "$init" ]; then
        echo "=> Running init script for $repo_name..."
        $init
    fi
fi
echo "Operation completed successfully."
