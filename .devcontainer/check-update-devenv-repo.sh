#!/bin/bash

script_path=$(readlink -f "$0")
script_folder=$(dirname "$script_path")

# Set the update interval if not already set in the environment
DEVENV_UPDATE_INTERVAL=${DEVENV_UPDATE_INTERVAL:-$((8 * 3600))} # 12 hours default

# Path to the .update-time file
UPDATE_FILE="$script_folder/.update-time"

# Function to update the repository
update_repo() {
    git pull > /dev/null 2>&1
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
    git fetch > /dev/null 2>&1
    date +%s > "$UPDATE_FILE"
fi


# Check if there are any changes in the remote master branch
LOCAL_HASH=$(git rev-parse master)
REMOTE_HASH=$(git rev-parse origin/master)

if [ "$LOCAL_HASH" == "$REMOTE_HASH" ]; then
    exit 1
fi

CURRENT_VERSION=$(git tag -l 'v*' | sort -V | tail -n 1)
if [[ $CURRENT_VERSION =~ ([0-9]+)\.([0-9]+)\.([0-9]+)(-([a-zA-Z0-9]+)\.([0-9]+))? ]]; then
    CURRENT_MAJOR_VERSION=${BASH_REMATCH[1]}
    CURRENT_MINOR_VERSION=${BASH_REMATCH[2]}
    CURRENT_PATCH_VERSION=${BASH_REMATCH[3]}
else
    echo "Error: VERSION format is not recognized"
    exit 1
fi

# Ask the user if they want to update the repository
echo "Changes detected on the remote master branch for the development environment."
read -p "Do you want to update? (y/n): " answer
case $answer in
    [Yy]* )
        update_repo
        if [ "$CURRENT_MAJOR_VERSION" != "$MAJOR_VERSION" ]; then
            echo 
            echo "********************************************************"
            echo "Major version changed.  Please rebuild dev container!"
            echo "********************************************************"
            echo 
        fi
        exit 0;
        ;;
    * )
        ;;
esac

exit 1;
