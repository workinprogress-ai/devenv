#!/bin/bash
# pr-thread-reply.sh - Reply to an inline review comment on a GitHub PR
# Version: 1.0.0
# Description: Posts a reply to an existing review comment (not a top-level PR comment)
# Requirements: Bash 4.0+, gh CLI, jq
# Author: WorkInProgress.ai
# Last Modified: 2026-05-08

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Reply to an inline review comment on a GitHub PR"

# ============================================================================
# Global Variables
# ============================================================================

PR_NUMBER=""
COMMENT_ID=""
COMMENT_BODY=""
COMMENT_FILE=""
USE_EDITOR=0
DRY_RUN=0
VERBOSE=0
ALLOW_DEVENV_REPO=0
TEMP_FILE=""

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME PR_NUMBER --comment-id COMMENT_ID [OPTIONS]

Reply to an existing inline review comment on a GitHub pull request.

The COMMENT_ID is the numeric REST API comment ID from the review thread.
Use `pr-threads-get PR_NUMBER` to list threads and find comment IDs.

This is distinct from \`pr-comment\` (top-level PR conversation comments).

Arguments:
    PR_NUMBER                   PR number

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be posted without posting
    --comment-id COMMENT_ID     The numeric ID of the comment to reply to (required)
    --devenv                    Safety override to reply on devenv repo PRs

Reply Source (one required):
    -b, --body TEXT             Reply text (inline)
    -f, --body-file FILE        Read reply from file (markdown)
    -e, --edit                  Open \$EDITOR to compose reply

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)
    EDITOR                      Editor to use with --edit (default: nano)

Examples:
    # Reply inline
    $SCRIPT_NAME 123 --comment-id 456 --body "Done — refactored in the latest commit."

    # Reply from file
    $SCRIPT_NAME 123 --comment-id 456 --body-file reply.md

    # Dry run
    $SCRIPT_NAME 123 --comment-id 456 --body "LGTM" --dry-run

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

cleanup() {
    if [ -n "$TEMP_FILE" ] && [ -f "$TEMP_FILE" ]; then
        rm -f "$TEMP_FILE"
        log_verbose "Cleaned up temp file: $TEMP_FILE"
    fi
}
trap cleanup EXIT

validate_pr_number() {
    local pr="$1"
    if ! [[ "$pr" =~ ^[0-9]+$ ]]; then
        log_error "Invalid PR number: $pr (must be numeric)"
        return 1
    fi
}

validate_comment_id() {
    local cid="$1"
    if ! [[ "$cid" =~ ^[0-9]+$ ]]; then
        log_error "Invalid comment ID: $cid (must be numeric)"
        return 1
    fi
}

compose_in_editor() {
    TEMP_FILE=$(mktemp /tmp/gh-pr-reply.XXXXXX.md)
    local editor="${EDITOR:-nano}"
    log_verbose "Opening editor: $editor"
    if ! "$editor" "$TEMP_FILE"; then
        log_error "Editor exited with error"
        exit 1
    fi
    COMMENT_BODY=$(cat "$TEMP_FILE")
    if [ -z "$(echo "$COMMENT_BODY" | tr -d '[:space:]')" ]; then
        log_error "Reply body is empty — aborting"
        exit 1
    fi
}

resolve_body() {
    if [ "$USE_EDITOR" -eq 1 ]; then
        compose_in_editor
    elif [ -n "$COMMENT_FILE" ]; then
        if [ ! -f "$COMMENT_FILE" ]; then
            log_error "File not found: $COMMENT_FILE"
            exit 1
        fi
        COMMENT_BODY=$(cat "$COMMENT_FILE")
    fi
    if [ -z "$(echo "${COMMENT_BODY:-}" | tr -d '[:space:]')" ]; then
        log_error "Reply body is empty"
        exit 1
    fi
}

post_reply() {
    local repo_spec_args=()
    read -ra repo_spec_args <<< "$(get_repo_spec)"

    # Extract owner/repo for REST API
    local repo_owner repo_name
    if [[ "${repo_spec_args[*]}" =~ -R[[:space:]]([^/]+)/([^[:space:]]+) ]]; then
        repo_owner="${BASH_REMATCH[1]}"
        repo_name="${BASH_REMATCH[2]}"
    else
        local remote_url
        remote_url=$(git remote get-url origin 2>/dev/null || echo "")
        if [[ "$remote_url" =~ github\.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
            repo_owner="${BASH_REMATCH[1]}"
            repo_name="${BASH_REMATCH[2]}"
        else
            log_error "Cannot determine repository owner/name."
            exit 1
        fi
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        log_info "[DRY RUN] Would reply to comment #$COMMENT_ID on PR #$PR_NUMBER:"
        echo "$COMMENT_BODY"
        return 0
    fi

    log_verbose "Posting reply to comment #$COMMENT_ID on PR #$PR_NUMBER"

    # Use REST API: POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies
    local response
    response=$(gh api \
        -X POST \
        "/repos/$repo_owner/$repo_name/pulls/$PR_NUMBER/comments/$COMMENT_ID/replies" \
        -f body="$COMMENT_BODY" \
        2>&1) || {
        log_error "Failed to post reply: $response"
        exit 1
    }

    local reply_url
    reply_url=$(echo "$response" | jq -r '.html_url // empty')
    log_info "Reply posted: ${reply_url:-PR #$PR_NUMBER}"
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

    ensure_gh_login

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)         show_usage ;;
            -v|--version)      echo "$SCRIPT_VERSION"; exit 0 ;;
            -V|--verbose)      VERBOSE=1; shift ;;
            -n|--dry-run)      DRY_RUN=1; shift ;;
            --devenv)          ALLOW_DEVENV_REPO=1; shift ;;
            --comment-id)      COMMENT_ID="$2"; shift 2 ;;
            -b|--body)         COMMENT_BODY="$2"; shift 2 ;;
            -f|--body-file)    COMMENT_FILE="$2"; shift 2 ;;
            -e|--edit)         USE_EDITOR=1; shift ;;
            -*)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
            *)
                if [ -z "$PR_NUMBER" ]; then
                    PR_NUMBER="$1"
                else
                    log_error "Unexpected argument: $1"
                    echo "Use --help for usage information"
                    exit 1
                fi
                shift
                ;;
        esac
    done

    if [ -z "$PR_NUMBER" ]; then
        log_error "PR number is required"
        echo "Use --help for usage information"
        exit 1
    fi
    if [ -z "$COMMENT_ID" ]; then
        log_error "--comment-id is required"
        echo "Use --help for usage information"
        exit 1
    fi
    if [ -z "$COMMENT_BODY" ] && [ -z "$COMMENT_FILE" ] && [ "$USE_EDITOR" -eq 0 ]; then
        log_error "One of --body, --body-file, or --edit is required"
        echo "Use --help for usage information"
        exit 1
    fi

    validate_pr_number "$PR_NUMBER"
    validate_comment_id "$COMMENT_ID"
    check_target_repo "$ALLOW_DEVENV_REPO"
    resolve_body
    post_reply
}

main "$@"
