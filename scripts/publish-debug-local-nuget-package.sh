#!/bin/bash

target=${1:-$(pwd)}
version=${2:-'9999.9999.9999'}

# Find all .csproj files in the target directory and its subdirectories
csproj_files=$(find "$target" -type f -name "*.csproj")

if [[ -z "$csproj_files" ]]; then 
    echo "Ooops! No csproj found in the specified directory ($target)!"
    exit 1;
fi

publish_dir=./bin/Publish
mkdir -p "$publish_dir"
rm ${publish_dir}/*.nupkg &>/dev/null

# Loop through each .csproj file found
for csproj in $csproj_files; do

    if [[ "$csproj" == *"/test/"* ]]; then
        echo "Skipping $csproj"
        echo 
        continue
    fi

    echo 
    echo -------------------------------------
    echo Restoring "$csproj"
    echo 
    dotnet restore "$csproj" --no-cache
    if [[ "$?" != 0 ]]; then exit 1; fi;

    echo 
    echo -------------------------------------
    echo Building "$csproj"
    echo 
    dotnet build "$csproj" -c Debug --no-restore -p:Version=$version -p:AssemblyVersion=$version -p:FileVersion=$version
    if [[ "$?" != 0 ]]; then exit 1; fi;

    echo 
    echo -------------------------------------
    echo Packing "$csproj"
    echo 
    dotnet pack "$csproj" --include-symbols --no-build -c Debug -o $publish_dir -p:Version=$version -p:AssemblyVersion=$version
    if [[ "$?" != 0 ]]; then exit 1; fi;

done

echo 
echo -------------------------------------
echo Pushing packages
echo 
dotnet nuget push ${publish_dir}/*.nupkg --source "$DEVENV_ROOT/.debug/local-nuget-dev"

if [[ "$?" != 0 ]]; then exit 1; fi;

# Find all package names in the local feed
local_feed_dir="$devenv/.debug/local-nuget-dev"
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
    fi
done
