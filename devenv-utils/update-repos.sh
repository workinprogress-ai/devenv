#!/bin/bash

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")
repo_list_file=$toolbox_root/repo_list
repo_folder="$1"
if [ -z "$repo_folder" ]; then
  repo_folder=$toolbox_root/repos
fi;

# Check if the repo_list file exists
if [[ ! -f $repo_list_file ]]; then
  echo "Error: repo_list file not found!"
  exit 1
fi

# Create the repos directory if it doesn't exist
mkdir -p $repo_folder

echo 
echo "Updating repos to $repo_folder" 
echo "----------------------------------------";
echo 
# Read the repo_list file line by line
while IFS= read -r repo_url; do
  if [[ -n "$repo_url" ]]; then
    # Only clone a repository if it doesn't already exist
    repo_name=$(basename "$repo_url" .git)
    if [[ -d "$repo_folder/$repo_name" ]]; then
      echo "**** Fetching and pulling $repo_name."
      cd "$repo_folder/$repo_name"
      git fetch --all --tags
      git pull --all
      cd - &>/dev/null
      echo "****"
      echo 
    else
      echo "**** Cloning $repo_url..."
      git clone "$repo_url" "$repo_folder/$repo_name"
      git fetch --tags
      echo "****" 
      echo 
    fi
  fi
done < $repo_list_file

echo "----------------------------------------";
echo "Done updating repos in $repo_folder."
echo 
