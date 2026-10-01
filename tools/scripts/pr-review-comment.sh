#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
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
# shellcheck disable=SC2034  # VERBOSE is written here; read by log_verbose in error-handling.bash

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/provider-loader.bash"
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
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
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
    DEVENV_REPO                 Repository in format owner/repo (default: curren
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
    if ! sha=$(provider_prs_view "${repo_spec[0]:-}" "$PR_NUMBER" --json headRefOid -q .headRefOid 2>/dev/null); then
        log_error "Failed to fetch PR #$PR_NUMBER head SHA"
        exit $EXIT_API_FAILURE
    fi
    echo "$sha"
}

# Post the inline comment via the provider thread contract verb.
post_inline_comment() {
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"

    if [ -n "$COMMENT_FILE" ]; then
        COMMENT_BODY=$(cat "$COMMENT_FILE")
    fi

    if [ -z "$(echo "$COMMENT_BODY" | tr -d '[:space:]')" ]; then
        log_error "Comment body is empty — aborting"
        exit "$EXIT_GENERAL_ERROR"
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

    log_verbose "Posting inline comment on PR #$PR_NUMBER ($FILE_PATH:$LINE_NUMBER $SIDE, head ${head_sha:0:7})"

    local result
    if ! result=$(provider_prs_thread_create "${repo_spec[0]:-}" "$PR_NUMBER" \
        --body "$COMMENT_BODY" \
        --path "$FILE_PATH" \
        --line "$LINE_NUMBER" \
        --side "$SIDE" 2>&1); then
        log_error "Failed to post inline review comment on PR #$PR_NUMBER"
        echo "$result"
        exit $EXIT_API_FAILURE
    fi

    local thread_url
    thread_url=$(echo "$result" | jq -r '.thread.url // empty')
    local errors
    errors=$(echo "$result" | jq -r '.errors[0].message // empty')
    if [ -n "$errors" ]; then
        log_error "GraphQL error: $errors"
        exit "$EXIT_GENERAL_ERROR"
    fi
    if [ -z "$thread_url" ]; then
        log_error "Failed to post inline review comment (no thread URL returned)"
        echo "$result"
        exit $EXIT_API_FAILURE
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
        exit $EXIT_MISUSE
    fi

    # Global flags handled before PR-number validation (--help must work
    # even though the first positional is a PR number).
    if handle_global_flag "$1"; then
        exit 0
    fi

    if [ $# -gt 0 ] && [[ "$1" =~ ^[0-9]+$ ]]; then
        PR_NUMBER="$1"
        shift
    fi

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
                # shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
                VERBOSE=1; shift ;;
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
                ALLOW_DEVENV_REPO=1; shift ;;
            -h|--help)
                show_usage ;;
            -v|--version)
                echo "$SCRIPT_VERSION"; exit 0 ;;
            *)
                # Accept the PR number as a positional in any position.
                if [ -z "$PR_NUMBER" ] && [[ "$1" =~ ^[0-9]+$ ]]; then
                    PR_NUMBER="$1"
                    shift
                    continue
                fi
                log_error "Unknown option or unexpected argument: $1"
                echo "Use --help for usage information"
                exit $EXIT_MISUSE
                ;;
        esac
    done

    # Validate required inputs (before any network/auth dependency)
    if [ -z "$FILE_PATH" ]; then
        log_error "--file is required (repo-relative path as shown in the diff)"
        exit $EXIT_MISUSE
    fi
    if [ -z "$LINE_NUMBER" ]; then
        log_error "--line is required"
        exit $EXIT_MISUSE
    fi
    if ! [[ "$LINE_NUMBER" =~ ^[0-9]+$ ]]; then
        log_error "Invalid line number: $LINE_NUMBER (must be numeric)"
        exit $EXIT_MISUSE
    fi
    case "$SIDE" in
        RIGHT|LEFT) ;;
        *)
            log_error "Invalid side: $SIDE (must be RIGHT or LEFT)"
            exit $EXIT_MISUSE
            ;;
    esac
    if [ -z "$COMMENT_BODY" ] && [ -z "$COMMENT_FILE" ]; then
        log_error "One of --body or --body-file is required"
        exit $EXIT_MISUSE
    fi

    validate_pr_number "$PR_NUMBER" || exit $EXIT_MISUSE

    ensure_provider_auth
    check_dependencies
    check_target_repo

    post_inline_comment
}

# Run main function
main "$@"
