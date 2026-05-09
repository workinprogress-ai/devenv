#!/bin/bash
# pr-thread-resolve.sh - Mark a PR review thread as resolved
# Version: 1.0.0
# Description: Resolves an unresolved review thread using the GitHub GraphQL API
# Requirements: Bash 4.0+, gh CLI
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
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Mark a PR review thread as resolved"

# ============================================================================
# Global Variables
# ============================================================================

THREAD_ID=""
DRY_RUN=0
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME THREAD_ID [OPTIONS]

Mark a pull request review thread as resolved.

The THREAD_ID is the GraphQL node ID of the review thread (starts with
"PRRT_" on GitHub). Use `pr-threads-get PR_NUMBER` to list threads
and find their IDs.

Arguments:
    THREAD_ID                   GraphQL node ID of the review thread to resolve
                                (e.g. PRRT_kwDOA...)

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without resolving
    --devenv                    Safety override for devenv repo threads

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (not needed for
                                this script — thread IDs are globally unique)

Examples:
    # Resolve a thread
    $SCRIPT_NAME PRRT_kwDOAbc123

    # Dry run
    $SCRIPT_NAME PRRT_kwDOAbc123 --dry-run

    # Resolve all unresolved threads on PR 123 (use with care)
    pr-threads-get 123 | jq -r '.[].id' | xargs -I{} $SCRIPT_NAME {}

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

resolve_thread() {
    if [ "$DRY_RUN" -eq 1 ]; then
        log_info "[DRY RUN] Would resolve review thread: $THREAD_ID"
        return 0
    fi

    log_verbose "Resolving review thread: $THREAD_ID"

    local mutation='
mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) {
    thread {
      id
      isResolved
    }
  }
}'

    local response
    response=$(gh api graphql \
        -f query="$mutation" \
        -f threadId="$THREAD_ID" \
        2>&1) || {
        log_error "Failed to resolve thread: $response"
        exit 1
    }

    local errors
    errors=$(echo "$response" | jq -r '.errors // empty' 2>/dev/null || echo "")
    if [ -n "$errors" ]; then
        log_error "GraphQL error resolving thread: $errors"
        exit 1
    fi

    local is_resolved
    is_resolved=$(echo "$response" | jq -r '.data.resolveReviewThread.thread.isResolved // "unknown"')

    if [ "$is_resolved" = "true" ]; then
        log_info "Thread resolved: $THREAD_ID"
    else
        log_error "Thread may not have resolved correctly (isResolved=$is_resolved)"
        exit 1
    fi
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    if [ $# -eq 0 ]; then
        log_error "THREAD_ID is required"
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
            -h|--help)    show_usage ;;
            -v|--version) echo "$SCRIPT_VERSION"; exit 0 ;;
            -V|--verbose) VERBOSE=1; shift ;;
            -n|--dry-run) DRY_RUN=1; shift ;;
            --devenv)     ALLOW_DEVENV_REPO=1; shift ;;
            -*)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
            *)
                if [ -z "$THREAD_ID" ]; then
                    THREAD_ID="$1"
                else
                    log_error "Unexpected argument: $1"
                    echo "Use --help for usage information"
                    exit 1
                fi
                shift
                ;;
        esac
    done

    if [ -z "$THREAD_ID" ]; then
        log_error "THREAD_ID is required"
        echo "Use --help for usage information"
        exit 1
    fi

    # Thread IDs are globally unique node IDs — no repo context needed for resolve
    # but still validate we're in the right environment
    check_target_repo "$ALLOW_DEVENV_REPO"
    resolve_thread
}

main "$@"
