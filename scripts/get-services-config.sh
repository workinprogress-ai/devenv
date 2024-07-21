#!/bin/bash

## This script obtains the config information by cloning the repo and then removing the .git folder
## This script is destructive in that it will remove existing files in the target folder

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
toolbox_root=$(dirname "$script_folder")

target_folder=${3:-$CONFIG_FOLDER}
target_folder=${target_folder:-$toolbox_root/.debug/config}

if [[ -d "$target_folder" ]]; then
    cd "$target_folder"
    existing_files_count=$(find . -maxdepth 2 -type f -not \( -name "default.env" -o -name "*.json" -o -name "README.md" -o -name "." -o -name ".git" -o -name ".gitignore" \) | wc -l)
    #existing_files=$(find . -not \( -name "*.json" -o -name "." \))
    if [[ "$existing_files_count" != "0" ]]; then
        echo "Target exists and contains files.  Cannot proceed."
        cd - &>/dev/null
        exit 1
    fi

    rm -fr "$target_folder" &>/dev/null
    cd - &>/dev/null
fi

"$script_folder/clone-config-repo.sh" $@
cd - &>/dev/null

# Remove the .git folder so that this is no longer a git repo
rm -fr $target_folder/.git

echo "Done!  If you previously created a 'default.env' file, you will need to recreate it."
