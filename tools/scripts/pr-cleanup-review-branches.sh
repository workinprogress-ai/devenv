#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
source "$DEVENV_TOOLS/lib/error-handling.bash"

################################################################################
# pr-cleanup-review-branches.sh
#
# Clean up old review branches from the repository
#
# Usage:
#   ./pr-cleanup-review-branches.sh [--dry-run] [repo-directory] [days-old]
#
# Arguments:
#   repo-directory - Path to repository (default: current directory)
#   days-old - Remove branches older than this many days (default: 30)
#
# Options:
#   --dry-run - Print which branches would be deleted; delete nothing
#
# Dependencies:
#   - git
#   - git-operations.bash
#
################################################################################

set -euo pipefail
source "$DEVENV_TOOLS/lib/git-operations.bash"

show_usage() {
  cat << 'EOF'
Usage: pr-cleanup-review-branches [--dry-run] [REPO_DIR] [DAYS_OLD]

Delete remote review branches (origin/review/*) older than DAYS_OLD days.
Only branches named exactly as pr-create-for-review creates them are
considered: review/<8-hex-id>-YYYY-MM-DD-target or -source. The age comes from
that date. Any other name under review/ is left untouched, reported as an
error, and makes the run exit non-zero.

Arguments:
    REPO_DIR    Repository path (default: current directory)
    DAYS_OLD    Age threshold in days (default: 30)

Options:
    --dry-run   Print which branches would be deleted; delete nothing
    -h, --help  Show this help and exit
EOF
  exit 0
}

explode() {
  echo "Error: $1" >&2
  exit "$EXIT_GENERAL_ERROR"
}

DRY_RUN=false
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    -h|--help) show_usage ;;
    --dry-run) DRY_RUN=true ;;
    -*)
      echo "Error: Unknown option: $arg" >&2
      exit "$EXIT_MISUSE"
      ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done
if [ "${#POSITIONAL[@]}" -gt 2 ]; then
  echo "Error: Too many arguments (expected [REPO_DIR] [DAYS_OLD])" >&2
  exit "$EXIT_MISUSE"
fi

REPO_DIR="${POSITIONAL[0]:-$(pwd)}"
DAYS="${POSITIONAL[1]:-30}"
if ! [[ "$DAYS" =~ ^[0-9]+$ ]]; then
  echo "Error: DAYS_OLD must be a non-negative integer, got '$DAYS'" >&2
  exit "$EXIT_MISUSE"
fi

# Validate git context using library function
if ! validate_git_context "$REPO_DIR"; then
  explode "Invalid git context: $REPO_DIR is not a valid git repository"
fi

cd "$REPO_DIR" || explode "Failed to change to repository directory $REPO_DIR."

git fetch origin || explode "Failed to fetch branches from the remote."

REVIEW_BRANCHES=$(git branch -r --list "origin/review/*")
if [ -z "$REVIEW_BRANCHES" ]; then
  echo "No review branches found."
  exit 0
fi

echo "Found review branches:"
echo "$REVIEW_BRANCHES"

CURRENT_DATE=$(date +%s)

# Exactly what pr-create-for-review.sh creates: review/<8-hex-id>-YYYY-MM-DD-
# followed by target or source. Anchored on both ends so a name that merely
# contains something date-like (an issue number, a second date) is never read
# as a date: deleting a branch on a guess is the one thing this tool must not do.
REVIEW_BRANCH_RE='^review/[0-9a-f]{8}-([0-9]{4})-([0-9]{2})-([0-9]{2})-(target|source)$'
UNRECOGNIZED=0

while IFS= read -r BRANCH; do
  BRANCH="${BRANCH#"${BRANCH%%[![:space:]]*}"}"
  BRANCH="${BRANCH#origin/}"
  [ -n "$BRANCH" ] || continue

  if ! [[ "$BRANCH" =~ $REVIEW_BRANCH_RE ]]; then
    echo "ERROR: $BRANCH is not a recognized review branch name (expected review/<id>-YYYY-MM-DD-target|source); left untouched." >&2
    UNRECOGNIZED=$((UNRECOGNIZED + 1))
    continue
  fi

  BRANCH_DATE_FULL="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]}"
  if ! BRANCH_DATE_EPOCH=$(date -d "$BRANCH_DATE_FULL" +%s 2>/dev/null); then
    echo "ERROR: $BRANCH carries an invalid date ($BRANCH_DATE_FULL); left untouched." >&2
    UNRECOGNIZED=$((UNRECOGNIZED + 1))
    continue
  fi
  DIFF_DAYS=$(((CURRENT_DATE - BRANCH_DATE_EPOCH) / 86400))

  if [ "$DIFF_DAYS" -ge "$DAYS" ]; then
    if [ "$DRY_RUN" = true ]; then
      echo "Would delete remote branch $BRANCH (last updated $DIFF_DAYS days ago)"
    else
      delete_branch "$BRANCH" origin || explode "Failed to delete remote branch $BRANCH"
      echo "Deleted remote branch $BRANCH"
    fi
  else
    echo "Skipping branch $BRANCH, last updated $DIFF_DAYS days ago."
  fi
done <<< "$REVIEW_BRANCHES"

if [ "$UNRECOGNIZED" -gt 0 ]; then
  echo "Review branch cleanup finished with $UNRECOGNIZED branch(es) left untouched (see errors above)." >&2
  exit "$EXIT_GENERAL_ERROR"
fi

if [ "$DRY_RUN" = true ]; then
  echo "Dry run complete; nothing was deleted."
else
  echo "Review branch cleanup completed."
fi
