#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

################################################################################
# pr-merge.sh
#
# Merge (complete) an open pull request from the current branch
#
# Usage:
#   ./pr-merge.sh [commit-message] [options]
#
# Description:
#   Finds the open PR from the current branch to the target branch (defaults to
#   the repository's default branch) and merges it. The merge method applied
#   when --method is omitted is policy, not tooling: it comes from the org/fork
#   configuration. For squash merges the first line of the commit message (or
#   the PR title when omitted) becomes the squash commit title, so it must
#   follow Conventional Commits — that is the only method where a title
#   convention is enforced. Draft PRs are refused unless --force.
#
# Options:
#   [commit-message]      Commit message (first line must be Conventional Commits
#                         format). If omitted, the PR title is used. Multi-line
#                         supported: first line is title, remainder is body.
#   --issue <number>      Issue number this PR addresses (optional)
#   --method <method>     Merge method (provider-supported: squash, merge,
#                         rebase). Omitted = org/fork policy default.
#   --base <branch>       Target branch (default: repository's default branch)
#   --repo-dir <path>     Repository directory (default: current directory)
#   --force               Force merge even if checks have not passed
#   --help                Show this help message
#
# Examples:
#   # Merge the open PR from the current branch (policy-default method)
#   pr-merge
#
#   # Merge with a custom commit message
#   pr-merge "feat(api): add user endpoint"
#
#   # With an issue reference
#   pr-merge "feat(api): add user endpoint" --issue 42
#
#   # Merge commit instead of rebase
#   pr-merge --method merge
#
#   # Force merge even if checks haven't passed
#   pr-merge --force
#
#   # Target a specific base branch
#   pr-merge "feat: new feature" --issue 7 --base develop
#
# Dependencies:
#   - git
#   - gh (GitHub CLI)
#   - jq
#   - error-handling.bash
#   - provider-loader.bash
#   - git-operations.bash
#   - issue-operations.bash
#
################################################################################

set -euo pipefail
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/provider-loader.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"
#
# Org identity (policy_org) arrives transitively via provider-loader
# (which loads the policy layer); no explicit policy sourcing here.

usage() {
    cat << 'EOF' >&2
Usage: pr-merge [commit-message] [options]

Merge an open pull request from the current branch.

Arguments:
  [commit-message]        Message whose first line must follow Conventional
                          Commits for squash merges (e.g., "feat(api): add
                          endpoint"). If omitted, the PR title is used with
                          no body.

Options:
  --issue <number>        Issue number this PR addresses (optional)
  --select                Pick the issue interactively (uses issue-select)
  --no-issue-id           Explicitly indicate this PR has no associated issue
  --method <method>       Merge method (squash, merge, rebase). Omitted =
                          org/fork policy default.
  --base <branch>         Target branch (default: repository's default branch)
  --repo-dir <path>       Repository directory (default: current directory)
  --branch <name>         Source branch for PR lookup (default: current branch)
  --force                 Force merge even if checks have not passed
  --keep-branch           Keep the source branch after merge (deleted by default)
  --help                  Show this help message

Examples:
  pr-merge
  pr-merge "feat(api): add user endpoint" --issue 42
  pr-merge --method merge
  pr-merge --force
EOF
    exit "$EXIT_GENERAL_ERROR"
}

COMMIT_MESSAGE=""
ISSUE_NUMBER=""
SELECT_ISSUE="false"
NO_ISSUE_ID="false"
MERGE_METHOD="rebase"
TARGET_BRANCH=""
SOURCE_BRANCH=""
REPO_DIR="$(pwd)"
FORCE="false"
KEEP_BRANCH="false"

POSITIONAL=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --issue)
            ISSUE_NUMBER="$2"; shift 2 ;;
        --select)
            SELECT_ISSUE="true"; shift ;;
        --no-issue-id)
            NO_ISSUE_ID="true"; shift ;;
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
        --keep-branch)
            KEEP_BRANCH="true"; shift ;;
        -h|--help)
            usage ;;
        *)
            POSITIONAL+=("$1"); shift ;;
    esac
done
set -- "${POSITIONAL[@]}"

COMMIT_MESSAGE="${1:-}"

if [ "$SELECT_ISSUE" = "true" ] && [ "$NO_ISSUE_ID" = "true" ]; then
    log_error "Cannot specify both --select and --no-issue-id."
    exit $EXIT_MISUSE
fi
if [ -n "$ISSUE_NUMBER" ] && [ "$NO_ISSUE_ID" = "true" ]; then
    log_error "Cannot specify both --issue and --no-issue-id."
    exit $EXIT_MISUSE
fi
if [ -n "$ISSUE_NUMBER" ] && [ "$SELECT_ISSUE" = "true" ]; then
    log_error "Cannot specify both --issue and --select."
    exit $EXIT_MISUSE
fi

if [ "$SELECT_ISSUE" = "true" ]; then
    log_info "Selecting issue interactively..."
    ISSUE_NUMBER="$("$DEVENV_TOOLS/scripts/issue-select.sh")" || true
    if [ -z "$ISSUE_NUMBER" ]; then
        log_error "No issue selected."
        exit "$EXIT_GENERAL_ERROR"
    fi
fi

if [ -n "$ISSUE_NUMBER" ]; then
    if ! validate_issue_number "$ISSUE_NUMBER"; then
        log_error "Issue number must be numeric and positive."
        exit $EXIT_MISUSE
    fi
fi

# Validate merge method
if ! merge_method_allowed "$MERGE_METHOD"; then
    log_error "Invalid merge method: $MERGE_METHOD (must be one of: $DEVENV_MERGE_METHODS)"
    exit $EXIT_MISUSE
fi

# Validate git context
if ! validate_git_context "$REPO_DIR" "main|master|review/*"; then
    exit "$EXIT_GENERAL_ERROR"
fi

CURRENT_BRANCH=${SOURCE_BRANCH:-$(get_current_branch)}

# Resolve target branch
if [ -z "$TARGET_BRANCH" ]; then
    TARGET_BRANCH=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
    TARGET_BRANCH=${TARGET_BRANCH:-master}
fi

if ! git show-ref --quiet "refs/remotes/origin/$TARGET_BRANCH"; then
    log_error "Target branch origin/$TARGET_BRANCH not found."
    exit $EXIT_API_FAILURE
fi

# Get repo spec for gh commands
read -ra repo_spec <<< "$(get_repo_spec)"

# Find open PR from current branch to target
log_info "Looking for an open PR from '$CURRENT_BRANCH' -> '$TARGET_BRANCH'..."
PR_ID=$(find_pr_by_branches "$CURRENT_BRANCH" "$TARGET_BRANCH" "${repo_spec[*]}") || true
if [ -z "$PR_ID" ]; then
    log_error "No open PR found from '$CURRENT_BRANCH' to '$TARGET_BRANCH'."
    exit $EXIT_API_FAILURE
fi

# If no commit message provided, use the PR title
if [ -z "$COMMIT_MESSAGE" ]; then
    PR_DETAILS=$(get_pr_details "$PR_ID" "${repo_spec[*]}") || true
    if [ -z "$PR_DETAILS" ]; then
        log_error "Failed to fetch PR details for #$PR_ID."
        exit $EXIT_API_FAILURE
    fi
    COMMIT_MESSAGE=$(echo "$PR_DETAILS" | jq -r '.title // ""')
    if [ -z "$COMMIT_MESSAGE" ]; then
        log_error "PR #$PR_ID has no title."
        exit "$EXIT_GENERAL_ERROR"
    fi
    log_info "Using PR title as commit message: $COMMIT_MESSAGE"
fi

# Extract title and body from commit message
COMMIT_TITLE="$(printf "%s" "$COMMIT_MESSAGE" | head -n1)"
COMMIT_BODY="$(printf "%s" "$COMMIT_MESSAGE" | tail -n +2 || true)"

# Check if PR is a draft — refuse before any validation so the operator
# isn't sent to fix a message on a PR that cannot merge anyway.
if is_pr_draft "$PR_ID" "${repo_spec[*]}"; then
    if [ "$FORCE" = "true" ]; then
        log_warn "PR #$PR_ID is a draft. Proceeding due to --force."
    else
        log_error "PR #$PR_ID is a draft. Convert it to open before merging, or use --force."
        exit "$EXIT_GENERAL_ERROR"
    fi
fi

# Squash-only title validation: under rebase and merge commits the PR title
# is discarded and the individual commits control versioning, so nothing is
# enforced here. For a squash the first line becomes the squash commit title,
# which must follow Conventional Commits.
if [ "$MERGE_METHOD" = "squash" ]; then
    if ! validate_conventional_commits "$COMMIT_TITLE"; then
        log_error "Squash merge commit message must follow Conventional Commits on the first line."
        log_error "Got: '$COMMIT_TITLE'"
        exit "$EXIT_GENERAL_ERROR"
    fi
fi

# Check issue consistency between CLI arg and PR description
if [ -n "$ISSUE_NUMBER" ]; then
    DESC_ISSUE_ID=$(extract_issue_from_pr "$PR_ID" "${repo_spec[*]}") || true
    if [ -n "$DESC_ISSUE_ID" ] && [ "$ISSUE_NUMBER" != "$DESC_ISSUE_ID" ]; then
        log_error "PR #$PR_ID references issue #$DESC_ISSUE_ID but --issue $ISSUE_NUMBER was provided."
        exit "$EXIT_GENERAL_ERROR"
    fi
fi

# Build merge commit message
MERGE_COMMIT_MESSAGE=$(build_merge_commit_message "$COMMIT_TITLE" "$COMMIT_BODY" "$PR_ID" "$ISSUE_NUMBER")

# Defense-in-depth: reject WIP-bearing ranges at merge time, warn on
# breaking markers (docs/Commit-Conventions.md). The create-time guard
# fails fast; this catches anything that slipped past it.
if ! wip_range_guard "${TARGET_BRANCH}..${CURRENT_BRANCH}" "merge range for PR #${PR_ID}"; then
    exit "$EXIT_GENERAL_ERROR"
fi
breaking_marker_scan "${TARGET_BRANCH}..${CURRENT_BRANCH}"

# Merge the PR
if ! merge_pr "$PR_ID" "$MERGE_COMMIT_MESSAGE" "$MERGE_METHOD" "${repo_spec[*]}" "$FORCE" "$KEEP_BRANCH"; then
    log_error "Failed to merge PR #$PR_ID. Check for merge conflicts or branch protection rules."
    exit $EXIT_API_FAILURE
fi

# Build PR URL for output
# Web-UI link built through the provider URL seam (host lives in the provider).
policy_org="$(provider_org_get 2>/dev/null || true)"
if [ -n "$policy_org" ]; then
    repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
    PR_URL="$(provider_web_url "${policy_org}/${repo_name}" "pull/$PR_ID")"
else
    PR_URL="$(provider_web_url "$(provider_repos_view "${repo_spec[0]:-}" --json owner,name --jq '.owner.login + "/" + .name')" "pull/$PR_ID")"
fi

echo ""
echo "Pull request #$PR_ID merged successfully ($MERGE_METHOD)."
echo "PR: $PR_URL"
