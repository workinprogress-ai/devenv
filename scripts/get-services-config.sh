#!/bin/bash

## This script obtains the config information by cloning the repo and then removing the .git folder
## This script is destructive in that it will remove existing files in the target folder

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")

branch=$1
target_folder=${CONFIG_FOLDER:-$toolbox_root/.debug/config}

return_to_folder=$(pwd)
if [[ "$(pwd)" == "$target_folder" ]]; then
    cd .. &>/dev/null
fi

if [[ -d "$target_folder" ]]; then
    rm -fr "$target_folder" &>/dev/null
fi

mkdir -p $target_folder

echo "Getting the config repo from the remote"
GIT_URL="https://${GITHUB_USER}:${DEVENV_GH_TOKEN}@oms-fort.visualstudio.com/OMSNIC-Fortress-Website/_git/services-config"
git clone $GIT_URL $target_folder

if [[ $? -ne 0 ]]; then
    echo "git clone of config repo failed".
    exit 1
fi

if [ -n "$branch" ]; then
    cd "$target_folder"
    git checkout $branch 
    cd - &>/dev/null
fi

# Remove the .git folder so that this is no longer a git repo
rm -fr $target_folder/*.*
rm -fr $target_folder/.git
rm -fr $target_folder/.gitignore    
rm -fr $target_folder/.azuredevops
rm -fr $target_folder/.husky
rm -fr $target_folder/.repo
rm -fr $target_folder/.vscode
rm -fr $target_folder/node_modules
rm -fr $target_folder/scripts

echo "Config refreshed:
$(date)
${branch:-master}" > $target_folder/info.txt
echo "DICTIONARY_SERVER=
DOCUMENT_SERVER=" > $target_folder/default.env

echo "Done!  If you previously created a 'default.env' file, you will need to recreate it."
