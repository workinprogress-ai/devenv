#!/bin/bash
# update_interactive.sh - checks for updates and, if found, interacts with the user to perform an update

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")
cd "$script_folder" || exit 1
devenv=$(dirname "$script_folder")

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
LOCAL_HASH=$(git rev-parse "$CURRENT_BRANCH")
REMOTE_HASH=$(git rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null)

# If no new updates are available, exit.
if [ "$LOCAL_HASH" == "$REMOTE_HASH" ]; then
    cd - > /dev/null || return 
    exit 0
fi

# If the current branch is not master, warn the user and ask for confirmation.
if [ "$CURRENT_BRANCH" != "master" ]; then
    echo "WARNING: The current branch ${CURRENT_BRANCH} is different on the remote."
    read -p "Do you want to update? (y/n): " answer
    case $answer in
        [Yy]* )
            $devenv/tools/git-update
            cd - > /dev/null || return
            echo "Be aware that you may need to rebuild the dev container or re-run the bootstrap depending on the changes."
            exit 0;;
        * )
            cd - > /dev/null || return
            exit 1;;
    esac
fi

# For the master branch, optionally determine the current version from git tags.
CURRENT_VERSION=$(git tag -l 'v*' | sort -V | tail -n 1)
if [[ "$CURRENT_VERSION" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    CURRENT_MAJOR_VERSION=${BASH_REMATCH[1]}
    CURRENT_MINOR_VERSION=${BASH_REMATCH[2]}
    # shellcheck disable=SC2034  # May be used in future version checks
    CURRENT_PATCH_VERSION=${BASH_REMATCH[3]}
else
    echo "Warning: VERSION format is not recognized.  Please update manually!"
    echo "You may also need to rebuild the dev container or re-run the bootstrap."
    echo "Current version: $CURRENT_VERSION"
    cd - > /dev/null || return
    exit 1
fi

echo "Changes detected on the remote master branch for the development environment."
read -p "Do you want to update? (y/n): " answer
case $answer in
    [Yy]* )
        $devenv/tools/git-update
        if [ $? -ne 0 ]; then
            cd - > /dev/null || return
            echo "Error updating the repository. Please update manually (e.g., run 'git pull')."
            echo "You may also need to rebuild the dev container or re-run the bootstrap."
            exit 1
        fi
        # Optionally, check for version changes (assumes $MAJOR_VERSION and $MINOR_VERSION are defined in your environment)
        if [ "$CURRENT_MAJOR_VERSION" != "$MAJOR_VERSION" ]; then
            echo
            echo "********************************************************"
            echo "MAJOR VERSION CHANGED.  Please rebuild dev container!"
            echo "********************************************************"
            echo
        elif [ "$CURRENT_MINOR_VERSION" != "$MINOR_VERSION" ]; then
            "$script_folder/bootstrap.sh"
            echo
            echo "********************************************************"
            echo "Minor version changed.  Please restart the dev container!"
            echo "********************************************************"
            echo
        else
            echo
            echo "Patch version change detected.  Update complete"
            echo
        fi
        
        cd - > /dev/null || return
        exit 0;;
    * )
        cd - > /dev/null || return
        exit 1;;
esac
