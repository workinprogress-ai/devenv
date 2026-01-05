#!/bin/bash
set -euo pipefail
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/fzf-selection.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"


# Create a PR from the current branch into the repo default branch (main/master by default).
# Uses GitHub CLI and prefers SSH remotes.



usage() {
  echo "Usage: $(basename "$0") <title> [options]" >&2
  echo "  --issue <number>     Issue number this PR addresses (required)" >&2
  echo "  --no-issue           Explicitly indicate this PR has no associated issue" >&2
  echo "  --repo-dir <path>    Repository directory (default: current)" >&2
  echo "  --base <branch>      Target branch (default: origin's HEAD)" >&2
  echo "  --body <text>        PR body text" >&2
  echo "  --draft              Create as draft" >&2
  echo "  --reviewer <handle>  Add a reviewer (can be repeated)" >&2
  echo "  --assignee <handle>  Add an assignee (default: @me)" >&2
  exit 1
}

PR_TITLE=""
PR_BODY=""
REPO_DIR="$(pwd)"
TARGET_BRANCH=""
DRAFT="false"
REVIEWERS=()
ASSIGNEES=("@me")
ISSUE_NUMBER=""
NO_ISSUE="false"

POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --issue)
      ISSUE_NUMBER="$2"; shift 2 ;;
    --no-issue)
      NO_ISSUE="true"; shift ;;
    --repo-dir)
      REPO_DIR="$2"; shift 2 ;;
    --base)
      TARGET_BRANCH="$2"; shift 2 ;;
    --body)
      PR_BODY="$2"; shift 2 ;;
    --draft)
      DRAFT="true"; shift ;;
    --reviewer)
      REVIEWERS+=("$2"); shift 2 ;;
    --assignee)
      ASSIGNEES+=("$2"); shift 2 ;;
    -h|--help)
      usage ;;
    *)
      POSITIONAL+=("$1"); shift ;;
  esac
done
set -- "${POSITIONAL[@]}"

PR_TITLE="${1:-}"
[ -n "$PR_TITLE" ] || usage

# Validate issue requirement
if [ -z "$ISSUE_NUMBER" ] && [ "$NO_ISSUE" != "true" ]; then
  echo "Error: Either --issue <number> or --no-issue must be specified." >&2
  echo "" >&2
  usage
fi

if [ -n "$ISSUE_NUMBER" ] && [ "$NO_ISSUE" = "true" ]; then
  echo "Error: Cannot specify both --issue and --no-issue." >&2
  exit 1
fi

if [ -n "$ISSUE_NUMBER" ]; then
  # Validate issue number using library function
  if ! validate_issue_number "$ISSUE_NUMBER"; then
    echo "Error: Issue number must be numeric and positive." >&2
    exit 1
  fi
fi

CC_REGEX='^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert|merge|patch|minor|major)(\([^)]+\))?(!)?: .+'
if ! [[ "$PR_TITLE" =~ $CC_REGEX ]]; then
  echo "Error: PR title must follow Conventional Commits (e.g., feat(api): add feature)." >&2
  exit 1
fi

cd "$REPO_DIR" 2>/dev/null || { echo "Failed to change directory to $REPO_DIR" >&2; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "Directory $REPO_DIR is not a git repository." >&2; exit 1; }

if ! git diff-index --quiet HEAD --; then
  echo "There are uncommitted or staged changes." >&2
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" == "review/"* ]]; then
  echo "This script cannot be run on a review/* branch." >&2
  exit 1
fi

if [ -z "$TARGET_BRANCH" ]; then
  TARGET_BRANCH=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
  TARGET_BRANCH=${TARGET_BRANCH:-main}
fi
if ! git show-ref --quiet "refs/remotes/origin/$TARGET_BRANCH"; then
  echo "Target branch origin/$TARGET_BRANCH not found." >&2
  exit 1
fi
if [ "$CURRENT_BRANCH" = "$TARGET_BRANCH" ]; then
  echo "Current branch matches target ($TARGET_BRANCH); switch to a feature branch first." >&2
  exit 1
fi

# Get repo spec
read -ra repo_spec <<< "$(get_repo_spec)"

existing_url=$(gh pr list "${repo_spec[@]}" --state open --head "$CURRENT_BRANCH" --json url --jq '.[0].url' 2>/dev/null || true)
if [ -n "$existing_url" ]; then
  echo "An open PR already exists for $CURRENT_BRANCH: $existing_url" >&2
  echo "$existing_url"
  exit 0
fi

# Add issue reference to PR body if provided
if [ -n "$ISSUE_NUMBER" ]; then
  if [ -n "$PR_BODY" ]; then
    PR_BODY="Closes #${ISSUE_NUMBER}

${PR_BODY}"
  else
    PR_BODY="Closes #${ISSUE_NUMBER}"
  fi
fi

args=(pr create --title "$PR_TITLE" --body "$PR_BODY" --base "$TARGET_BRANCH" --head "$CURRENT_BRANCH")
[ "$DRAFT" = "true" ] && args+=(--draft)
for reviewer in "${REVIEWERS[@]}"; do
  args+=(--reviewer "$reviewer")
done
for assignee in "${ASSIGNEES[@]}"; do
  args+=(--assignee "$assignee")
done

echo "Creating PR from $CURRENT_BRANCH -> $TARGET_BRANCH..." >&2
set +e
PR_URL=$(gh "${args[@]}" 2>&1 | grep -oE 'https://github.com[^ ]+' | head -n1)
status=$?
set -e

if [ $status -ne 0 ]; then
  echo "$PR_URL" >&2
  echo "Failed to create PR." >&2
  exit $status
fi

echo "$PR_URL"