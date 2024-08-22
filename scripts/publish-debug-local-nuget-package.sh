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
done

echo 
echo -------------------------------------
echo Pushing packages
echo 
dotnet nuget push ${publish_dir}/*.nupkg --source "$DEVENV_ROOT/.debug/local-nuget-dev"
if [[ "$?" != 0 ]]; then exit 1; fi;
