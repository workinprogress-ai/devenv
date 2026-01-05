#!/bin/bash
set -euo pipefail
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/fzf-selection.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"


# Create a draft "REVIEW:" PR using temporary source/target branches built from two commits.




explode() {
  echo "Error: $1" >&2
  git checkout "$CURRENT_BRANCH" &>/dev/null || true
  if [ -n "${TARGET_BRANCH:-}" ]; then
    delete_branch "$TARGET_BRANCH" origin &>/dev/null || true
  fi
  if [ -n "${SOURCE_BRANCH:-}" ]; then
    delete_branch "$SOURCE_BRANCH" origin &>/dev/null || true
  fi
  cd - &>/dev/null || true
  exit 1
}

random_name() { uuidgen | cut -c1-8; }
get_date() { date +"%Y-%m-%d"; }

script_folder=$(dirname "$(readlink -f "$0")")

select_commit() {
  local prompt="$1"
  [ -n "$versions" ] || explode "No version tags found in the repository."
  
  # Use fzf_select_single from library with custom options
  local selected
  selected=$(echo "$versions" | fzf --ansi --no-sort --tac --prompt="$prompt" --height=40%)
  
  if [ -n "$selected" ]; then
    local short_hash
    short_hash=$(echo "$selected" | awk '{print $5}')
    git rev-parse "$short_hash"
  else
    explode "Could not determine commit."
  fi
}

PR_DESCRIPTION="${1:-}"
if [ -z "$PR_DESCRIPTION" ]; then
  echo "Usage: $(basename "$0") <PR_DESCRIPTION> [REPO_DIR] [FROM_COMMIT] [TO_COMMIT]" >&2
  exit 1
fi

REPO_DIR="${2:-$(pwd)}"
cd "$REPO_DIR" || explode "Invalid repository folder: $REPO_DIR"

# Validate git context using library function
if ! validate_git_context "$REPO_DIR"; then
  explode "Invalid git context. Check that: 1) $REPO_DIR is a git repo, 2) working directory is clean"
fi

# Check that we're not on a review branch using library function
if branch_matches_pattern "review/*"; then
  explode "This script cannot be run on a review branch."
fi

CURRENT_BRANCH=$(get_current_branch)

versions=$("$script_folder/repo-version-list.sh")

FIRST_COMMIT="${3:-}"
if [ -z "$FIRST_COMMIT" ]; then
  clear
  echo >&2
  echo "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^" >&2
  echo "Please select the FROM commit to compare.  This is the FIRST one." >&2
  echo "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^" >&2
  echo >&2
  FIRST_COMMIT=$(select_commit "Select the FROM commit: ")
  clear
fi

FINAL_COMMIT="${4:-}"
if [ -z "$FINAL_COMMIT" ]; then
  clear
  echo >&2
  echo "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^" >&2
  echo "Please select the TO commit to compare.  This is the LAST one." >&2
  echo "^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^" >&2
  echo >&2
  FINAL_COMMIT=$(select_commit "Select the TO commit: ")
  clear
fi

if [ "$FIRST_COMMIT" != "$FINAL_COMMIT" ] && git merge-base --is-ancestor "$FINAL_COMMIT" "$FIRST_COMMIT"; then
  explode "The FROM and TO commits appear out of order."
fi

PARENT_COMMIT=$(git rev-parse "${FIRST_COMMIT}^") || explode "Failed to get the parent commit $FIRST_COMMIT"

BRANCH_BASE_NAME="review/$(random_name)-$(get_date)"
TARGET_BRANCH="${BRANCH_BASE_NAME}-target"
SOURCE_BRANCH="${BRANCH_BASE_NAME}-source"

git checkout -b "$TARGET_BRANCH" "$PARENT_COMMIT" &>/dev/null || explode "Failed to create new branch $TARGET_BRANCH"
git push origin "$TARGET_BRANCH" &>/dev/null || explode "Failed to push new branch $TARGET_BRANCH"

git checkout -b "$SOURCE_BRANCH" "$FINAL_COMMIT" &>/dev/null || explode "Failed to create new branch $SOURCE_BRANCH"
git push origin "$SOURCE_BRANCH" &>/dev/null || explode "Failed to push new branch $SOURCE_BRANCH"

PR_TITLE="REVIEW: $PR_DESCRIPTION"
PR_BODY="$PR_DESCRIPTION"

# Get repo spec
read -ra repo_spec <<< "$(get_repo_spec)"

echo "Creating draft PR for review comparison..." >&2
set +e
PR_URL=$(gh pr create "${repo_spec[@]}" \
  --title "$PR_TITLE" \
  --body "$PR_BODY" \
  --base "$TARGET_BRANCH" \
  --head "$SOURCE_BRANCH" \
  --draft \
  --assignee @me 2>&1 | grep -oE 'https://github.com[^ ]+' | head -n1)
status=$?
set -e

if [ $status -ne 0 ]; then
  explode "Failed to create pull request"
fi

git checkout "$CURRENT_BRANCH" &>/dev/null || explode "Failed to switch back to the current branch"
delete_branch "$TARGET_BRANCH" origin &>/dev/null || echo "Failed to delete the review branch $TARGET_BRANCH" >&2
delete_branch "$SOURCE_BRANCH" origin &>/dev/null || echo "Failed to delete the review branch $SOURCE_BRANCH" >&2

echo "$PR_URL"