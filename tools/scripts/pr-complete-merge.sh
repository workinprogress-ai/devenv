#!/bin/bash

# Name: pr-complete-merge.sh
# Purpose: Complete an existing PR from the current branch -> target branch,
#          using a Conventional Commits merge commit message provided as the 2nd arg.
#          Uses GitHub CLI (gh) for all operations.

set -euo pipefail
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"





explode() { echo "Error: $1" >&2; exit 1; }

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

# Validate issue arg using library function
if [ "$ISSUE_ID" != '--no-issue-id' ] && ! validate_issue_number "$ISSUE_ID"; then
  explode "First argument must be a numeric issue ID, or --no-issue-id, or --select."
fi

ISSUE_TAG=""
if [ "$ISSUE_ID" != '--no-issue-id' ]; then
  ISSUE_TAG="#${ISSUE_ID}"
fi

# Extract title and body from provided commit message (positional param 2)
COMMIT_TITLE_LINE="$(printf "%s" "$COMMIT_MESSAGE_RAW" | head -n1)"
COMMIT_BODY="$(printf "%s" "$COMMIT_MESSAGE_RAW" | tail -n +2 || true)"

# Validate conventional commits format using library function
if ! validate_conventional_commits "$COMMIT_TITLE_LINE"; then
  explode "Merge commit message must follow Conventional Commits on the first line. Got: '$COMMIT_TITLE_LINE'"
fi

# Validate git context using library function
if ! validate_git_context "$REPO_DIR" "main|master|review/*"; then
  explode "Invalid git context. Check that: 1) $REPO_DIR is a git repo, 2) working directory is clean, 3) not on main/master/review/* branch"
fi

# Get repo spec for gh commands
read -ra repo_spec <<< "$(get_repo_spec)"

# Find PR from current branch to target using library function
echo "Looking for an open PR from '$(get_current_branch)' -> '$TARGET_BRANCH'..." >&2
PR_ID=$(find_pr_by_branches "$(get_current_branch)" "$TARGET_BRANCH" "${repo_spec[@]}") || true
[ -n "$PR_ID" ] || explode "No open PR found from '$(get_current_branch)' to '$TARGET_BRANCH'."

# Check if PR is draft using library function
if is_pr_draft "$PR_ID" "${repo_spec[@]}"; then
  explode "PR $PR_ID is a Draft. Convert it to open before completing."
fi

# Get issue from PR description using library function
DESC_ISSUE_ID=$(extract_issue_from_pr "$PR_ID" "${repo_spec[@]}") || true
if [ -n "$DESC_ISSUE_ID" ] && [ "$ISSUE_ID" != '--no-issue-id' ] && [ "$ISSUE_ID" != "$DESC_ISSUE_ID" ]; then
  explode "PR $PR_ID description references a different issue (#$DESC_ISSUE_ID) than provided ($ISSUE_TAG)."
fi

# Build merge commit message using library function
MERGE_COMMIT_MESSAGE=$(build_merge_commit_message "$COMMIT_TITLE_LINE" "$COMMIT_BODY" "$PR_ID" "${ISSUE_ID%%-*}")

echo "Completing PR $PR_ID (squash + delete source branch)..." >&2

# Use library function to merge PR
if ! merge_pr_squash "$PR_ID" "$MERGE_COMMIT_MESSAGE" "${repo_spec[@]}"; then
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
