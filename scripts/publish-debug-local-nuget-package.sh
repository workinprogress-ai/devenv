#!/bin/bash

target=${1:-$(pwd)}
version=9999.9999.9999

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

    # Extract the package name from the .csproj file (using regex)
    package_name=$(grep -oPm1 "(?<=<PackageId>)[^<]+" "$csproj" | tr '[:upper:]' '[:lower:]')
    # If the package name is not found, use the .csproj file name as the package name
    if [[ -z "$package_name" ]]; then
        package_name=$(basename "$csproj" .csproj | tr '[:upper:]' '[:lower:]')
    fi
    package_cache_dir="$HOME/.nuget/packages/$package_name"

    if [[ -d "$package_cache_dir" ]]; then
        echo 
        echo -------------------------------------
        echo Removing cache for package "$package_name"
        echo 
        rm -rf "$package_cache_dir"
        if [[ "$?" != 0 ]]; then exit 1; fi;
    else
        echo "No cache found for package $package_name"
    fi

done

echo 
echo -------------------------------------
echo Pushing packages
echo 
dotnet nuget push ${publish_dir}/*.nupkg --source "$DEVENV_ROOT/.debug/local-nuget-dev"

#dotnet nuget locals all --clear
if [[ "$?" != 0 ]]; then exit 1; fi;
