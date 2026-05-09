#!/bin/bash
# pr-threads-get.sh - Fetch review threads (inline comments) for a GitHub PR
# Version: 1.0.0
# Description: Returns structured JSON of review threads, preserving thread relationships
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
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Fetch review threads (inline comments) for a GitHub PR"

# ============================================================================
# Global Variables
# ============================================================================

PR_NUMBER=""
OUTPUT_FORMAT="json"   # json | pretty
UNRESOLVED_ONLY=1
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME PR_NUMBER [OPTIONS]

Fetch review threads (inline comments) for a GitHub pull request.

Uses GraphQL to preserve thread structure — the REST API loses parent/reply
relationships and cannot filter by resolution status.

Arguments:
    PR_NUMBER                   PR number to fetch threads for

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --pretty                    Pretty-print JSON output (default: compact)
    --all                       Include resolved threads (default: unresolved only)
    --devenv                    Safety override to read PRs in devenv repo

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)

Output:
    JSON array of thread objects. Each thread:
        id              Thread node ID (for resolving via pr-thread-resolve)
        isResolved      boolean
        path            File path the comment is on
        line            Line number (null for file-level comments)
        startLine       Start of multi-line comment range (or null)
        diffSide        LEFT or RIGHT
        comments        Array of comment objects:
            id          Numeric REST API comment ID / databaseId (for replying via pr-thread-reply)
            author      {login}
            body        Comment text (markdown)
            createdAt   ISO 8601 timestamp
            url         Link to the comment on GitHub

Examples:
    # Fetch unresolved threads (default)
    $SCRIPT_NAME 123

    # Include resolved threads
    $SCRIPT_NAME 123 --all

    # Pretty-print
    $SCRIPT_NAME 123 --pretty

    # Count unresolved threads
    $SCRIPT_NAME 123 | jq length

    # Get files with open comments
    $SCRIPT_NAME 123 | jq -r '.[].path' | sort -u

    # Get first unresolved thread's comment body
    $SCRIPT_NAME 123 | jq -r '.[0].comments[0].body'

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

fetch_threads() {
    local repo_spec_args=()
    read -ra repo_spec_args <<< "$(get_repo_spec)"

    # Extract owner/repo for GraphQL
    local repo_owner repo_name
    if [[ "${repo_spec_args[*]}" =~ -R[[:space:]]([^/]+)/([^[:space:]]+) ]]; then
        repo_owner="${BASH_REMATCH[1]}"
        repo_name="${BASH_REMATCH[2]}"
    else
        # Fall back to current repo from git remote
        local remote_url
        remote_url=$(git remote get-url origin 2>/dev/null || echo "")
        if [[ "$remote_url" =~ github\.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
            repo_owner="${BASH_REMATCH[1]}"
            repo_name="${BASH_REMATCH[2]}"
        else
            log_error "Cannot determine repository owner/name. Set GITHUB_REPO or run inside a git repo with a GitHub remote."
            exit 1
        fi
    fi

    log_verbose "Fetching review threads for PR #$PR_NUMBER in $repo_owner/$repo_name"

    # GraphQL query — fetches review threads with nested comments
    # We use 100 threads per page; paginate if needed (most PRs have < 100)
    local query='
query($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          path
          line
          startLine
          diffSide
          comments(first: 50) {
            nodes {
              id
              databaseId
              author { login }
              body
              createdAt
              url
            }
          }
        }
      }
    }
  }
}'

    local all_threads="[]"
    local cursor="null"
    local has_next_page=true

    while [ "$has_next_page" = "true" ]; do
        local cursor_arg
        if [ "$cursor" = "null" ]; then
            cursor_arg='null'
        else
            cursor_arg="\"$cursor\""
        fi

        local response
        response=$(gh api graphql \
            -f query="$query" \
            -f owner="$repo_owner" \
            -f repo="$repo_name" \
            -F pr="$PR_NUMBER" \
            --raw-field cursor="$cursor_arg" \
            2>/dev/null || true)

        if [ -z "$response" ]; then
            log_error "GraphQL query returned empty response"
            exit 1
        fi

        # Check for errors in the response
        local errors
        errors=$(echo "$response" | jq -r '.errors // empty' 2>/dev/null || echo "")
        if [ -n "$errors" ]; then
            log_error "GraphQL error: $errors"
            exit 1
        fi

        local page_threads
        page_threads=$(echo "$response" | jq '.data.repository.pullRequest.reviewThreads.nodes')

        has_next_page=$(echo "$response" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')
        cursor=$(echo "$response" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor // "null"')

        # Merge pages
        all_threads=$(echo "$all_threads $page_threads" | jq -s '.[0] + .[1]')
    done

    # Filter to unresolved if requested; flatten comment structure
    local filter
    if [ "$UNRESOLVED_ONLY" -eq 1 ]; then
        filter='map(select(.isResolved == false))'
    else
        filter='.'
    fi

    # Normalise: flatten the nested comments.nodes to comments[]
    local result
    result=$(echo "$all_threads" | jq "$filter | map({
        id: .id,
        isResolved: .isResolved,
        path: .path,
        line: .line,
        startLine: .startLine,
        diffSide: .diffSide,
        comments: (.comments.nodes | map({id: .databaseId, nodeId: .id, author: .author, body: .body, createdAt: .createdAt, url: .url}))
    }) | sort_by(.path, .line)")

    if [ "$OUTPUT_FORMAT" = "pretty" ]; then
        echo "$result" | jq '.'
    else
        echo "$result" | jq -c '.'
    fi
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
            -h|--help)
                show_usage
                ;;
            -v|--version)
                echo "$SCRIPT_VERSION"
                exit 0
                ;;
            -V|--verbose)
                VERBOSE=1
                shift
                ;;
            --pretty)
                OUTPUT_FORMAT="pretty"
                shift
                ;;
            --all)
                UNRESOLVED_ONLY=0
                shift
                ;;
            --devenv)
                ALLOW_DEVENV_REPO=1
                shift
                ;;
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

    validate_pr_number "$PR_NUMBER"
    check_target_repo "$ALLOW_DEVENV_REPO"
    fetch_threads
}

main "$@"
