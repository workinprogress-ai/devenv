#!/bin/bash
# pr-get.sh - Retrieve GitHub PR details as structured JSON
# Version: 1.0.0
# Description: Fetches a single PR's data as JSON for scripting and automation
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
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Retrieve GitHub PR details as structured JSON"

# ============================================================================
# Global Variables
# ============================================================================

PR_NUMBER=""
OUTPUT_FORMAT="json"   # json | pretty
VERBOSE=0
ALLOW_DEVENV_REPO=0

# Default fields returned in JSON output
readonly DEFAULT_FIELDS="number,title,body,state,isDraft,headRefName,baseRefName,author,labels,assignees,reviewRequests,milestone,mergeable,mergeStateStatus,url,createdAt,updatedAt,closedAt,mergedAt,comments,reviews"

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME PR_NUMBER [OPTIONS]

Retrieve a GitHub pull request's details as structured JSON.

Arguments:
    PR_NUMBER                   PR number to retrieve

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --pretty                    Pretty-print JSON output (default: compact)
    --devenv                    Safety override to read PRs in devenv repo

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)

Output Fields:
    number             PR number
    title              PR title
    body               PR description (markdown)
    state              OPEN, CLOSED, or MERGED
    isDraft            Whether the PR is a draft
    headRefName        Source branch name
    baseRefName        Target branch name
    author             Author object {login, name}
    labels             Array of label objects {name, color, description}
    assignees          Array of assignee objects {login, name}
    reviewRequests     Array of requested reviewer objects
    milestone          Milestone object or null
    mergeable          MERGEABLE, CONFLICTING, or UNKNOWN
    mergeStateStatus   CLEAN, DIRTY, BLOCKED, etc.
    url                PR URL
    createdAt          ISO 8601 creation timestamp
    updatedAt          ISO 8601 last-updated timestamp
    closedAt           ISO 8601 close timestamp or null
    mergedAt           ISO 8601 merge timestamp or null
    comments           Array of conversation comments
    reviews            Array of review summaries

Examples:
    # Get PR as JSON
    $SCRIPT_NAME 123

    # Pretty-printed
    $SCRIPT_NAME 123 --pretty

    # Extract a single field with jq
    $SCRIPT_NAME 123 | jq -r '.title'

    # Get the head branch
    $SCRIPT_NAME 123 | jq -r '.headRefName'

    # Pipe into another script
    $SCRIPT_NAME 123 | jq -r '.state'

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

# Validate PR number is a positive integer
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

# Fetch and output the PR
get_pr() {
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"

    log_verbose "Fetching PR #$PR_NUMBER"

    local json
    if ! json=$(gh pr view "${repo_spec[@]}" "$PR_NUMBER" \
            --json "$DEFAULT_FIELDS" 2>/dev/null); then
        log_error "PR #$PR_NUMBER not found"
        exit 1
    fi

    if [ "$OUTPUT_FORMAT" = "pretty" ]; then
        echo "$json" | jq .
    else
        echo "$json"
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
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
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
                    if ! validate_pr_number "$1"; then
                        exit 1
                    fi
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

    check_target_repo

    get_pr
}

main "$@"
