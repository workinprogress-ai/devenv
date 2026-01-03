#!/bin/bash

# Name: pr-complete-merge.sh
# Purpose: Complete an existing PR from the current branch -> master (if present),
#          using a Conventional Commits merge commit message provided as the 2nd arg.
#          Uses GitHub CLI (gh) for all operations.

set -euo pipefail

explode() { echo "Error: $1" >&2; exit 1; }
is_numeric() { [[ "${1:-}" =~ ^-?[0-9]+$ ]]; }

TARGET_BRANCH="master"

ISSUE_ID="${1:-}"
COMMIT_MESSAGE_RAW="${2:-}"
REPO_DIR="${3:-$(pwd)}"

if [ -z "${ISSUE_ID:-}" ] || [ -z "${COMMIT_MESSAGE_RAW:-}" ]; then
  echo "Usage: pr-complete-merge.sh <ISSUE_ID | --select | --no-issue-id> \"<CommitMessage>\" [REPO_DIR]" >&2
  exit 1
fi

# Resolve --select
if [ "$ISSUE_ID" == '--select' ]; then
  echo "Selecting issue interactively..." >&2
  ISSUE_ID="$(issue-select.sh)" || true
  [ -n "$ISSUE_ID" ] || explode "No issue selected. Provide a valid issue ID."
fi

# Validate issue arg
if [ "$ISSUE_ID" != '--no-issue-id' ] && ! is_numeric "$ISSUE_ID"; then
  explode "First argument must be a numeric issue ID, or --no-issue-id, or --select."
fi

ISSUE_TAG=""
if [ "$ISSUE_ID" != '--no-issue-id' ]; then
  ISSUE_TAG="#${ISSUE_ID}"
fi

# Extract title and body from provided commit message (positional param 2)
COMMIT_TITLE_LINE="$(printf "%s" "$COMMIT_MESSAGE_RAW" | head -n1)"
COMMIT_BODY="$(printf "%s" "$COMMIT_MESSAGE_RAW" | tail -n +2 || true)"

# Validate first line (Conventional Commits)
regex_pattern='^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert|merge)(\([^)]+\))?(!)?: .+'
if ! [[ "$COMMIT_TITLE_LINE" =~ $regex_pattern ]]; then
  explode "Merge commit message must follow Conventional Commits on the first line. Got: '$COMMIT_TITLE_LINE'"
fi

# Ensure repo context
cd "$REPO_DIR" 2>/dev/null || explode "Failed to change directory to $REPO_DIR"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || explode "Directory $REPO_DIR is not a git repository."

if [ -f "$DEVENV_ROOT/tools/lib/github-helpers.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/github-helpers.bash"
fi

# Hygiene checks
if ! git diff-index --quiet HEAD --; then
  explode "There are uncommitted or staged changes in the current branch."
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ] || explode "This script cannot be run on the $TARGET_BRANCH branch."
[[ "$CURRENT_BRANCH" != review/* ]] || explode "This script cannot be run on a review/* branch."

# Get repo spec for gh commands
read -ra repo_spec <<< "$(get_repo_spec)"

# Find PR from current -> target using gh CLI
echo "Looking for an open PR from '$CURRENT_BRANCH' -> '$TARGET_BRANCH'..." >&2
PR_ID=$(gh pr list "${repo_spec[@]}" --head "$CURRENT_BRANCH" --base "$TARGET_BRANCH" --state open --json number --jq '.[0].number' 2>/dev/null) || true
[ -n "$PR_ID" ] || explode "No open PR found from '$CURRENT_BRANCH' to '$TARGET_BRANCH'."

# Get PR details
PR_JSON=$(gh pr view "${repo_spec[@]}" "$PR_ID" --json title,body,isDraft,state --jq . 2>/dev/null) || explode "Failed to get PR details."
PR_IS_DRAFT=$(echo "$PR_JSON" | jq -r '.isDraft')
PR_DESCRIPTION=$(echo "$PR_JSON" | jq -r '.body // ""')

[ "$PR_IS_DRAFT" != "true" ] || explode "PR $PR_ID is a Draft. Convert it to open before completing."

# If PR description references an issue and it differs from provided, fail
DESC_ISSUE_ID="$(echo "$PR_DESCRIPTION" | grep -Eo '#[0-9]+' | head -n1 | tr -d '#')" || true
if [ -n "${DESC_ISSUE_ID:-}" ] && [ "$ISSUE_ID" != '--no-issue-id' ] && [ "$ISSUE_ID" != "$DESC_ISSUE_ID" ]; then
  explode "PR $PR_ID description references a different issue (#$DESC_ISSUE_ID) than provided ($ISSUE_TAG)."
fi

# Trim commit body (remove leading/trailing blank lines) and, if non-empty, append a blank line,
# so the footer is on its own line
TRIMMED_BODY="$(printf "%s" "$COMMIT_BODY" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | awk 'NF' ORS="\n")"
if [ -n "$TRIMMED_BODY" ]; then
  TRIMMED_BODY="${TRIMMED_BODY}

"
fi

# Build final merge commit message:
#   <title>
#
#   <trimmed body>
#      #<PR_ID> <ISSUE_TAG>
MERGE_COMMIT_MESSAGE="$COMMIT_TITLE_LINE

${TRIMMED_BODY}   #$PR_ID $ISSUE_TAG"

echo "Completing PR $PR_ID (squash + delete source branch)..." >&2

# Use gh to merge PR with squash and commit message
if ! gh pr merge "${repo_spec[@]}" "$PR_ID" --squash --delete-branch --body "$MERGE_COMMIT_MESSAGE" 2>&1; then
  explode "Failed to complete PR $PR_ID. (Merge conflicts or branch protection rules may be the cause.)"
fi

echo
echo "✅ Pull request $PR_ID completed successfully."
if [ -n "${GH_ORG:-}" ]; then
    repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
    echo "PR: https://github.com/${GH_ORG}/${repo_name}/pull/$PR_ID"
else
    echo "PR: https://github.com/$(gh repo view "${repo_spec[@]}" --json owner,name --jq '.owner.login + "/" + .name')/pull/$PR_ID"
fi
