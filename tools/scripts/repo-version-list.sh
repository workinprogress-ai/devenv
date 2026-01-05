#!/bin/bash

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/release-operations.bash"

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

first_commit=true
for tag in $tags; do
  commit_hash=$(git rev-list -n 1 "$tag")
  commit_date=$(git show -s --format=%ci "$commit_hash" | cut -d' ' -f1,2 | cut -d':' -f1,2)
  short_hash=$(git show -s --format=%h "$commit_hash")
  title=$(git show -s --format=%s "$commit_hash")
  version="${tag#v}"

  if $first_commit; then
    change_type="🔷"
    tag_color="$LIGHT_BLUE"
    first_commit=false
  else
    change_type=$(get_version_change_type "$version")
    tag_color="$RED"
    [[ "$change_type" == "🟡" ]] && tag_color="$YELLOW"
    [[ "$change_type" == "🟢" ]] && tag_color="$GREEN"
  fi

  echo -e "$change_type ${GRAY}$commit_date${RESET} | ${LIGHT_BLUE}$short_hash${RESET} | ${tag_color}$tag${RESET} | ${BLUE}$title${RESET}"
done
