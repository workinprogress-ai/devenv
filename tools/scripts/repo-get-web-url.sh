#!/bin/bash
set -euo pipefail

REPO_DIR="${1:-$(pwd)}"
cd "$REPO_DIR" || { echo "Invalid repository folder: $REPO_DIR" >&2; exit 1; }

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "Directory $REPO_DIR is not a git repository." >&2
  exit 1
fi

remote_url=$(git config --get remote.origin.url)

if [[ $remote_url =~ github.com ]]; then
  # Normalize SSH or HTTPS remotes to an https://github.com/owner/repo form
  repo_url=$(echo "$remote_url" | sed -E 's#(git@|https://)([^:/]+)[:/]([^/]+)/([^/]+)(\.git)?#https://\2/\3/\4#')
  echo "$repo_url"
else
  echo "Not a GitHub repository." >&2
  exit 1
fi