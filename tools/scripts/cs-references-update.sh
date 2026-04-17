#!/bin/bash

# Make sure you're in the right directory
target=${1:-$(pwd)}

# Navigate to the specified directory
cd "$target" || { echo "Directory not found: $target"; exit 1; }

# Find all csproj files and update package references
find . -name '*.csproj' -print0 | while IFS= read -r -d '' csproj; do
  dotnet outdated "$csproj" --upgrade
done
#dotnet outdated "$csproj" --upgrade

