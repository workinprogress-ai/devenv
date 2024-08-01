#!/bin/bash

# Make sure you're in the right directory
if [ -z "$1" ]; then
  echo "Usage: $0 <directory>"
  exit 1
fi

# Navigate to the specified directory
cd "$1" || { echo "Directory not found: $1"; exit 1; }

# Find all csproj files and update package references
find . -name "*.csproj" | while read -r csproj; do
  echo "Updating packages in $csproj"
  dotnet restore "$csproj" --no-cache
  dotnet outdated "$csproj" --upgrade
done

echo "All packages have been updated."

