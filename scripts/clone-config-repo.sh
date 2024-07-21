#!/bin/bash

## This script clones the config repo into the specified folder.
## If the repo already exists, it is just updated.

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")

u=$1
p=$2
target_folder=${3:-$CONFIG_FOLDER}
target_folder=${target_folder:-$toolbox_root/.debug/config}

echo "Config target is $target_folder"
need_clone=true

if [[ -d "$target_folder" ]]; then
    cd "$target_folder"
    existing_files_count=$(find . -maxdepth 1 -not \( -name "*.json" -o -name "README.md" -o -name "." -o -name ".git" \) | wc -l)
    if [[ "$existing_files_count" != "0" ]]; then
        echo "Target exists and contains files.  Cannot proceed."
        exit 1
    fi
    cd - &>/dev/null

    if [[ -d "$target_folder/.git" ]]; then
        echo "Target exists and is a git repo."
        need_clone=false
    else
        rm -fr "$target_folder" &>/dev/null
    fi
fi

if [[ "$need_clone" == "true" ]]; then
    mkdir -p $target_folder
    echo "Cloning the config repo from the remote"
    if [[ -z $u ]]; then
        git clone https://oms-fort.visualstudio.com/OMSNIC-Fortress-Website/_git/services-config $target_folder # &>/dev/null
        if [[ $? -ne 0 ]]; then
            echo "git clone of config repo failed".
            echo "Please re-run the script and provide the user name and password that can be used to clone the config repo"
            echo "Usage:  $0 [branch] [user] [password] [target_folder]"
            exit 1
        fi
    else
        git clone https://$u:$p@oms-fort.visualstudio.com/OMSNIC-Fortress-Website/_git/services-config $target_folder # &>/dev/null
        if [[ $? -ne 0 ]]; then
            echo "Failed to clone the config repo"
            exit 1
        fi
    fi
fi

cd "$target_folder"
git reset --hard &>/dev/null
git pull &> /dev/null
cd - &>/dev/null
