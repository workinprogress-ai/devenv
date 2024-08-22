#!/bin/bash

# Make sure you're in the right directory
target=${1:-$(pwd)}

# Navigate to the specified directory
cd "$target" || { echo "Directory not found: $target"; exit 1; }

# Find all csproj files and update package references
#dotnet restore "$csproj" --no-cache
dotnet outdated "$csproj" --upgrade

