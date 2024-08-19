#!/bin/bash

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")

cd $script_folder

# Set the update interval if not already set in the environment
DEVENV_UPDATE_INTERVAL=${DEVENV_UPDATE_INTERVAL:-$((8 * 3600))} # 12 hours default

# Path to the .update-time file
UPDATE_FILE="$script_folder/.update-time"

# Function to update the repository
update_repo() {
    git fetch --tags -f > /dev/null 2>&1
    date +%s > "$UPDATE_FILE"
}

# Check if the .update-time file exists
if [ ! -f "$UPDATE_FILE" ]; then
    date +%s > "$UPDATE_FILE"
    exit 1
fi

# Read the last update time
LAST_UPDATE=$(cat "$UPDATE_FILE")

# Get the current time
CURRENT_TIME=$(date +%s)

# Calculate the time difference
TIME_DIFF=$((CURRENT_TIME - LAST_UPDATE))

# Check if the time difference is greater than the update interval
if [ "$TIME_DIFF" -gt "$DEVENV_UPDATE_INTERVAL" ]; then
    # Fetch changes from the remote repository silently
    update_repo &
fi


# Check if there are any changes in the remote master branch
LOCAL_HASH=$(git rev-parse master)
REMOTE_HASH=$(git rev-parse origin/master)

if [ "$LOCAL_HASH" == "$REMOTE_HASH" ]; then
    cd - &> /dev/null
    exit 1
fi

CURRENT_VERSION=$(git tag -l 'v*' | sort -V | tail -n 1)
if [[ $CURRENT_VERSION =~ ([0-9]+)\.([0-9]+)\.([0-9]+)(-([a-zA-Z0-9]+)\.([0-9]+))? ]]; then
    CURRENT_MAJOR_VERSION=${BASH_REMATCH[1]}
    CURRENT_MINOR_VERSION=${BASH_REMATCH[2]}
    CURRENT_PATCH_VERSION=${BASH_REMATCH[3]}
else
    echo "Warning: VERSION format is not recognized"
    CURRENT_MAJOR_VERSION=0
    CURRENT_MAJOR_VERSION=0
    CURRENT_MAJOR_VERSION=0
fi

# Ask the user if they want to update the repository
echo "Changes detected on the remote master branch for the development environment."
read -p "Do you want to update? (y/n): " answer
case $answer in
    [Yy]* )
        git pull > /dev/null 2>&1
        if [ "$CURRENT_MAJOR_VERSION" != "$MAJOR_VERSION" ]; then
            echo 
            echo "********************************************************"
            echo "MAJOR VERSION CHANGED.  Please rebuild dev container!"
            echo "********************************************************"
            echo 
        elif [ "$CURRENT_MINOR_VERSION" != "$MINOR_VERSION" ]; then
            $script_folder/bootstrap.sh
            echo 
            echo "********************************************************"
            echo "Minor version changed.  Please restart the dev container!"
            echo "********************************************************"
            echo 
        fi
        cd - &> /dev/null
        exit 0;
        ;;
    * )
        ;;
esac

cd - &> /dev/null
exit 1;
