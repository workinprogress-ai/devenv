#!/bin/bash

################################################################################
# pr-merge-pull-request.sh
#
# Merge (complete) an open pull request from the current branch
#
# Usage:
#   ./pr-merge-pull-request.sh [commit-message] [options]
#
# Description:
#   Finds the open PR from the current branch to the target branch (defaults to
#   the repository's default branch) and merges it. Defaults to squash merge but
#   supports merge commit and rebase via --method. If no commit message is
#   provided, uses the PR title. Validates Conventional Commits format on the
#   commit message. Deletes the source branch after merge.
#
# Options:
#   [commit-message]      Commit message (first line must be Conventional Commits
#                         format). If omitted, the PR title is used. Multi-line
#                         supported: first line is title, remainder is body.
#   --issue <number>      Issue number this PR addresses (optional)
#   --method <method>     Merge method: squash (default), merge, rebase
#   --base <branch>       Target branch (default: repository's default branch)
#   --repo-dir <path>     Repository directory (default: current directory)
#   --force               Force merge even if checks have not passed
#   --help                Show this help message
#
# Examples:
#   # Squash merge using the PR title as commit message
#   pr-merge-pull-request
#
#   # Squash merge with a custom commit message
#   pr-merge-pull-request "feat(api): add user endpoint"
#
#   # With an issue reference
#   pr-merge-pull-request "feat(api): add user endpoint" --issue 42
#
#   # Merge commit instead of squash
#   pr-merge-pull-request --method merge
#
#   # Rebase merge
#   pr-merge-pull-request "fix(auth): token refresh" --method rebase
#
#   # Force merge even if checks haven't passed
#   pr-merge-pull-request --force
#
#   # Target a specific base branch
#   pr-merge-pull-request "feat: new feature" --issue 7 --base develop
#
# Dependencies:
#   - git
#   - gh (GitHub CLI)
#   - jq
#   - error-handling.bash
#   - github-helpers.bash
#   - git-operations.bash
#   - issue-operations.bash
#
################################################################################

set -euo pipefail
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

usage() {
    cat << 'EOF' >&2
Usage: pr-merge-pull-request [commit-message] [options]

Merge an open pull request from the current branch.

Arguments:
  [commit-message]        Conventional Commits message (e.g., "feat(api): add endpoint").
                          If omitted, the PR title is used with no body.

Options:
  --issue <number>        Issue number this PR addresses (optional)
  --method <method>       Merge method: squash (default), merge, rebase
  --base <branch>         Target branch (default: repository's default branch)
  --repo-dir <path>       Repository directory (default: current directory)
  --branch <name>         Source branch for PR lookup (default: current branch)
  --force                 Force merge even if checks have not passed
  --help                  Show this help message

Examples:
  pr-merge-pull-request
  pr-merge-pull-request "feat(api): add user endpoint" --issue 42
  pr-merge-pull-request --method merge
  pr-merge-pull-request --force
EOF
    exit 1
}

COMMIT_MESSAGE=""
ISSUE_NUMBER=""
MERGE_METHOD="squash"
TARGET_BRANCH=""
SOURCE_BRANCH=""
REPO_DIR="$(pwd)"
FORCE="false"

POSITIONAL=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --issue)
            ISSUE_NUMBER="$2"; shift 2 ;;
        --method)
            MERGE_METHOD="$2"; shift 2 ;;
        --base)
            TARGET_BRANCH="$2"; shift 2 ;;
        --repo-dir)
            REPO_DIR="$2"; shift 2 ;;
        --branch)
            SOURCE_BRANCH="$2"; shift 2 ;;
        --force)
            FORCE="true"; shift ;;
        -h|--help)
            usage ;;
        *)
            POSITIONAL+=("$1"); shift ;;
    esac
done
set -- "${POSITIONAL[@]}"

COMMIT_MESSAGE="${1:-}"

if [ -n "$ISSUE_NUMBER" ]; then
    if ! validate_issue_number "$ISSUE_NUMBER"; then
        log_error "Issue number must be numeric and positive."
        exit 1
    fi
fi

# Validate merge method
case "$MERGE_METHOD" in
    squash|merge|rebase) ;;
    *)
        log_error "Invalid merge method: $MERGE_METHOD (must be squash, merge, or rebase)"
        exit 1
        ;;
esac

# Validate git context
if ! validate_git_context "$REPO_DIR" "main|master|review/*"; then
    exit 1
fi

CURRENT_BRANCH=${SOURCE_BRANCH:-$(get_current_branch)}

# Resolve target branch
if [ -z "$TARGET_BRANCH" ]; then
    TARGET_BRANCH=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
    TARGET_BRANCH=${TARGET_BRANCH:-master}
fi

if ! git show-ref --quiet "refs/remotes/origin/$TARGET_BRANCH"; then
    log_error "Target branch origin/$TARGET_BRANCH not found."
    exit 1
fi

# Get repo spec for gh commands
read -ra repo_spec <<< "$(get_repo_spec)"

# Find open PR from current branch to target
log_info "Looking for an open PR from '$CURRENT_BRANCH' -> '$TARGET_BRANCH'..."
PR_ID=$(find_pr_by_branches "$CURRENT_BRANCH" "$TARGET_BRANCH" "${repo_spec[*]}") || true
if [ -z "$PR_ID" ]; then
    log_error "No open PR found from '$CURRENT_BRANCH' to '$TARGET_BRANCH'."
    exit 1
fi

# If no commit message provided, use the PR title
if [ -z "$COMMIT_MESSAGE" ]; then
    PR_DETAILS=$(get_pr_details "$PR_ID" "${repo_spec[*]}") || true
    if [ -z "$PR_DETAILS" ]; then
        log_error "Failed to fetch PR details for #$PR_ID."
        exit 1
    fi
    COMMIT_MESSAGE=$(echo "$PR_DETAILS" | jq -r '.title // ""')
    if [ -z "$COMMIT_MESSAGE" ]; then
        log_error "PR #$PR_ID has no title."
        exit 1
    fi
    log_info "Using PR title as commit message: $COMMIT_MESSAGE"
fi

# Extract title and body from commit message
COMMIT_TITLE="$(printf "%s" "$COMMIT_MESSAGE" | head -n1)"
COMMIT_BODY="$(printf "%s" "$COMMIT_MESSAGE" | tail -n +2 || true)"

# Validate conventional commits format
if ! validate_conventional_commits "$COMMIT_TITLE"; then
    log_error "Commit message must follow Conventional Commits on the first line."
    log_error "Got: '$COMMIT_TITLE'"
    exit 1
fi

# Check if PR is a draft
if is_pr_draft "$PR_ID" "${repo_spec[*]}"; then
    if [ "$FORCE" = "true" ]; then
        log_warn "PR #$PR_ID is a draft. Proceeding due to --force."
    else
        log_error "PR #$PR_ID is a draft. Convert it to open before merging, or use --force."
        exit 1
    fi
fi

# Check issue consistency between CLI arg and PR description
if [ -n "$ISSUE_NUMBER" ]; then
    DESC_ISSUE_ID=$(extract_issue_from_pr "$PR_ID" "${repo_spec[*]}") || true
    if [ -n "$DESC_ISSUE_ID" ] && [ "$ISSUE_NUMBER" != "$DESC_ISSUE_ID" ]; then
        log_error "PR #$PR_ID references issue #$DESC_ISSUE_ID but --issue $ISSUE_NUMBER was provided."
        exit 1
    fi
fi

# Build merge commit message
MERGE_COMMIT_MESSAGE=$(build_merge_commit_message "$COMMIT_TITLE" "$COMMIT_BODY" "$PR_ID" "$ISSUE_NUMBER")

# Merge the PR
if ! merge_pr "$PR_ID" "$MERGE_COMMIT_MESSAGE" "$MERGE_METHOD" "${repo_spec[*]}" "$FORCE"; then
    log_error "Failed to merge PR #$PR_ID. Check for merge conflicts or branch protection rules."
    exit 1
fi

# Build PR URL for output
if [ -n "${GH_ORG:-}" ]; then
    repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
    PR_URL="https://github.com/${GH_ORG}/${repo_name}/pull/$PR_ID"
else
    PR_URL="https://github.com/$(gh repo view "${repo_spec[@]}" --json owner,name --jq '.owner.login + "/" + .name')/pull/$PR_ID"
fi

echo ""
echo "Pull request #$PR_ID merged successfully ($MERGE_METHOD)."
echo "PR: $PR_URL"
