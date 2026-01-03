#!/bin/bash

# Define the local NuGet feed directory
local_feed_dir="$devenv/.debug/local-nuget-dev"

# Check if the local feed directory exists
if [[ ! -d "$local_feed_dir" ]]; then
    echo "Local NuGet feed directory does not exist: $local_feed_dir"
    exit 1
fi

# Find all package names in the local feed
packages=$(find "$local_feed_dir" -type f -name "*.nupkg" | sed 's/.*\///' | sed 's/\(.*\)\.\(.*\)\.\(.*\)\.nupkg/\1/' | tr '[:upper:]' '[:lower:]' | sort -u)

had_error=0

# Clear the NuGet cache for each package
for package in $packages; do
    # Extract the package name without the version number
    package_name=$(echo "$package" | sed -E 's/\.[0-9]+(\.[0-9]+)*$//')

    package_cache_dir="$HOME/.nuget/packages/$package_name"
    
    if [[ -d "$package_cache_dir" ]]; then
        echo "Removing cache for package: $package_name"
        rm -rf "$package_cache_dir"
        if [[ $? != 0 ]]; then
            echo "WARNING:  Failed to remove cache for package: $package_name"
            had_error=1
        fi
    else
        echo "No cache found for package: $package_name"
    fi
done

# Clear the local NuGet feed folder
echo "Clearing local NuGet feed folder: $local_feed_dir"
rm -rf "$local_feed_dir"/* &>/dev/null

if [[ $? != 0 ]]; then
    echo "WARNING: Failed to clear local NuGet feed folder: $local_feed_dir"
    echo "Please try again or manually delete the contents of the folder."
fi

if [[ $had_error != 0 ]]; then
    echo "WARNING: Some packages may not have been removed from the cache."
    echo "Suggest running: dotnet nuget locals all --clear"
fi
