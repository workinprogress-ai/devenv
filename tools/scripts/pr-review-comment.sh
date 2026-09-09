#!/bin/bash
# pr-review-comment.sh - Create an inline review comment on a PR (new thread)
# Version: 1.0.0
# Description: Posts an inline review comment tied to a specific file and line
#              on a GitHub pull request, creating a new review thread via the
#              GraphQL API. Complements pr-comment (top-level conversation
#              comments) and pr-thread-reply (replying to existing threads).
# Requirements: Bash 4.0+, gh CLI, jq
# Author: WorkInProgress.ai
# Last Modified: 2026-09-08

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Create an inline review comment on a PR"

# ============================================================================
# Global Variables
# ============================================================================

PR_NUMBER=""
FILE_PATH=""
LINE_NUMBER=""
SIDE="RIGHT"
COMMENT_BODY=""
COMMENT_FILE=""
DRY_RUN=0
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME PR_NUMBER --file PATH --line N [OPTIONS] (--body TEXT | --body-file FILE)

Create an inline review comment on a GitHub pull request — starts a NEW review
thread tied to a specific file and line. Use pr-comment for top-level
conversation comments, pr-thread-reply to reply inside an existing thread.

Arguments:
    PR_NUMBER                   PR number to comment on

Required:
    -f, --file PATH             File path as shown in the PR diff (repo-relative)
    -l, --line N                Line number in the file (on the chosen side)
    -b, --body TEXT             Comment text (inline) — or --
    -F, --body-file FILE        Read comment from file (markdown)

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without posting
    -s, --side SIDE             Which side of the diff the line is on:
                                RIGHT (new file content, default) or LEFT
                                (original file content)
    --devenv                    Safety override to comment on devenv repo PRs

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: curren
t repo)

Examples:
    # Inline comment on a specific line
    $SCRIPT_NAME 123 --file src/Service.cs --line 42 --body "Null check missing"

    # Comment on the original (left) side of the diff
    $SCRIPT_NAME 123 --file src/Service.cs --line 40 --side LEFT --body-file note.md

    # Dry-run
    $SCRIPT_NAME 123 --file src/App.ts --line 7 --body "Typo" --dry-run

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

validate_pr_number() {
    local pr="$1"
    if [ -z "$pr" ]; then
        log_error "PR number cannot be empty"
        return 1
    fi
    if ! [[ "$pr" =~ ^[0-9]+$ ]]; then
        log_error "Invalid PR number: $pr (must be numeric)"
        return 1
    fi
    return 0
}

# Resolve the PR's head commit SHA (latest commit in the PR branch).
get_head_sha() {
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"
    local sha
    if ! sha=$(gh pr view "${repo_spec[@]}" "$PR_NUMBER" --json headRefOid -q .headRefOid 2>/dev/null); then
        log_error "Failed to fetch PR #$PR_NUMBER head SHA"
        exit 1
    fi
    echo "$sha"
}

# Resolve the repository node ID via GraphQL.
get_repo_node_id() {
    local owner_repo="${GITHUB_REPO:-}"
    if [ -z "$owner_repo" ]; then
        local repo_spec
        read -ra repo_spec <<< "$(get_repo_spec)"
        # get_repo_spec yields -R owner/repo; extract it
        owner_repo="${repo_spec[1]:-}"
    fi
    local node_id
    if ! node_id=$(gh api graphql -f query="query { repository(owner: \"${owner_repo%%/*}\", name: \"${owner_repo##*/}\") { id } }" 2>/dev/null | jq -r '.data.repository.id'); then
        log_error "Failed to resolve repository node ID for $owner_repo"
        exit 1
    fi
    if [ -z "$node_id" ] || [ "$node_id" = "null" ]; then
        log_error "Failed to resolve repository node ID for $owner_repo"
        exit 1
    fi
    echo "$node_id"
}

# Post the inline comment via GraphQL addPullRequestReviewThread.
post_inline_comment() {
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"

    if [ -n "$COMMENT_FILE" ]; then
        COMMENT_BODY=$(cat "$COMMENT_FILE")
    fi

    if [ -z "$(echo "$COMMENT_BODY" | tr -d '[:space:]')" ]; then
        log_error "Comment body is empty — aborting"
        exit 1
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        log_info "[DRY RUN] Would post inline review comment:"
        echo "  PR:     #$PR_NUMBER"
        echo "  File:   $FILE_PATH"
        echo "  Line:   $LINE_NUMBER ($SIDE side)"
        echo "  Body:"
        echo "$COMMENT_BODY"
        return 0
    fi

    local head_sha
    head_sha=$(get_head_sha)
    local repo_node_id
    repo_node_id=$(get_repo_node_id)

    log_verbose "Posting inline comment on PR #$PR_NUMBER ($FILE_PATH:$LINE_NUMBER $SIDE, head ${head_sha:0:7})"

    # shellcheck disable=SC2016  # GraphQL variables must not be shell-expanded
    local query='mutation($pr: ID!, $body: String!, $path: String!, $line: Int!, $side: DiffSide!, $repo: ID!) {
        addPullRequestReviewThread(input: {
            pullRequestId: $pr,
            body: $body,
            path: $path,
            line: $line,
            side: $side,
            repositoryId: $repo
        }) {
            thread { id url comments(first: 1) { nodes { databaseId } } }
        }
    }'

    local result
    if ! result=$(gh api graphql \
        -f query="$query" \
        -f pr="$(gh pr view "${repo_spec[@]}" "$PR_NUMBER" --json id -q .id)" \
        -f body="$COMMENT_BODY" \
        -f path="$FILE_PATH" \
        -F line="$LINE_NUMBER" \
        -f side="$SIDE" \
        -f repo="$repo_node_id" 2>&1); then
        log_error "Failed to post inline review comment on PR #$PR_NUMBER"
        echo "$result"
        exit 1
    fi

    local thread_url
    thread_url=$(echo "$result" | jq -r '.data.addPullRequestReviewThread.thread.url // empty')
    local errors
    errors=$(echo "$result" | jq -r '.errors[0].message // empty')
    if [ -n "$errors" ]; then
        log_error "GraphQL error: $errors"
        exit 1
    fi
    if [ -z "$thread_url" ]; then
        log_error "Failed to post inline review comment (no thread URL returned)"
        echo "$result"
        exit 1
    fi

    log_info "Inline review comment posted: $thread_url"
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    if [ $# -eq 0 ]; then
        log_error "PR number is required"
        echo "Use --help for usage information"
        exit 1
    fi

    case "$1" in
        -h|--help)    show_usage ;;
        -v|--version) echo "$SCRIPT_VERSION"; exit 0 ;;
    esac

    PR_NUMBER="$1"
    validate_pr_number "$PR_NUMBER" || exit 1
    shift

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -f|--file)
                FILE_PATH="$2"; shift 2 ;;
            -l|--line)
                LINE_NUMBER="$2"; shift 2 ;;
            -s|--side)
                SIDE="$2"; shift 2 ;;
            -b|--body)
                COMMENT_BODY="$2"; shift 2 ;;
            -F|--body-file)
                COMMENT_FILE="$2"; shift 2 ;;
            -n|--dry-run)
                DRY_RUN=1; shift ;;
            -V|--verbose)
                VERBOSE=1; shift ;;
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
                ALLOW_DEVENV_REPO=1; shift ;;
            -h|--help)
                show_usage ;;
            -v|--version)
                echo "$SCRIPT_VERSION"; exit 0 ;;
            *)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done

    # Validate required inputs (before any network/auth dependency)
    if [ -z "$FILE_PATH" ]; then
        log_error "--file is required (repo-relative path as shown in the diff)"
        exit 1
    fi
    if [ -z "$LINE_NUMBER" ]; then
        log_error "--line is required"
        exit 1
    fi
    if ! [[ "$LINE_NUMBER" =~ ^[0-9]+$ ]]; then
        log_error "Invalid line number: $LINE_NUMBER (must be numeric)"
        exit 1
    fi
    case "$SIDE" in
        RIGHT|LEFT) ;;
        *)
            log_error "Invalid side: $SIDE (must be RIGHT or LEFT)"
            exit 1
            ;;
    esac
    if [ -z "$COMMENT_BODY" ] && [ -z "$COMMENT_FILE" ]; then
        log_error "One of --body or --body-file is required"
        exit 1
    fi

    ensure_gh_login
    check_dependencies
    check_target_repo

    post_inline_comment
}

# Run main function
main "$@"
