#!/bin/bash

# ANSI color codes
GRAY='\033[1;30m'
LIGHT_BLUE='\033[1;36m'
RED='\033[1;31m'
YELLOW='\033[1;33m'
GREEN='\033[1;32m'
BLUE='\033[1;34m'
RESET='\033[0m'

# Ensure the script is being run in a Git repository
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "This script must be run inside a Git repository." >&2
  exit 1
fi

tags=$(git tag -l 'v*')
if [ -z "$tags" ]; then
  echo "No version tags found in the repository." >&2
  exit 0
fi

get_change_type_and_color() {
  local version="$1"
  local major minor patch
  major=$(echo "$version" | cut -d. -f1 | sed 's/^v//')
  minor=$(echo "$version" | cut -d. -f2)
  patch=$(echo "$version" | cut -d. -f3)

  if [ "$minor" = "0" ] && [ "$patch" = "0" ]; then
    echo "🔴" "$RED"
  elif [ "$patch" = "0" ]; then
    echo "🟡" "$YELLOW"
  else
    echo "🟢" "$GREEN"
  fi
}

first_commit=true
for tag in $tags; do
  commit_hash=$(git rev-list -n 1 "$tag")
  commit_date=$(git show -s --format=%ci "$commit_hash" | cut -d' ' -f1,2 | cut -d':' -f1,2)
  short_hash=$(git show -s --format=%h "$commit_hash")
  title=$(git show -s --format=%s "$commit_hash")

  if $first_commit; then
    change_type="🔷"
    tag_color="$LIGHT_BLUE"
    first_commit=false
  else
    change_info=$(get_change_type_and_color "$tag")
    change_type=$(echo "$change_info" | awk '{print $1}')
    tag_color=$(echo "$change_info" | awk '{print $2}')
  fi

  echo -e "$change_type ${GRAY}$commit_date${RESET} | ${LIGHT_BLUE}$short_hash${RESET} | ${tag_color}$tag${RESET} | ${BLUE}$title${RESET}"
done