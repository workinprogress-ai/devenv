#!/bin/bash
# pr-list.sh - List GitHub pull requests with filters
# Version: 1.0.0
# Description: Lists pull requests as JSON for scripting and automation
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
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "List GitHub pull requests with filters"

# ============================================================================
# Global Variables
# ============================================================================

STATE="open"     # open | closed | merged | all
AUTHOR=""
LABEL=""
BASE_BRANCH=""
HEAD_BRANCH=""
LIMIT="30"
OUTPUT_FORMAT="json"   # json | pretty | table
VERBOSE=0
ALLOW_DEVENV_REPO=0

readonly DEFAULT_FIELDS="number,title,state,isDraft,headRefName,baseRefName,author,labels,createdAt,updatedAt,url"

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

List and filter GitHub pull requests. Output is JSON by default.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --pretty                    Pretty-print JSON output
    --table                     Output as a human-readable table
    --devenv                    Safety override for devenv repo

Filters:
    -s, --state STATE           PR state: open, closed, merged, all (default: open)
    -a, --author USER           Filter by author login (use \`@me\` for self)
    -l, --label LABEL           Filter by label
    --base BRANCH               Filter by target branch
    --head BRANCH               Filter by source branch
    --limit N                   Max number of PRs to return (default: 30)

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)

Examples:
    # All open PRs (JSON)
    $SCRIPT_NAME

    # Pretty-printed table
    $SCRIPT_NAME --table

    # My open PRs
    $SCRIPT_NAME --author @me

    # Closed PRs labelled 'bug'
    $SCRIPT_NAME --state closed --label bug

    # PRs targeting master
    $SCRIPT_NAME --base master

    # Pipe into jq
    $SCRIPT_NAME | jq -r '.[] | "\(.number)\t\(.title)"'

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

# Fetch and output the PR list
list_prs() {
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"

    local gh_args=()
    gh_args+=("${repo_spec[@]}")
    gh_args+=(--state "$STATE")
    gh_args+=(--limit "$LIMIT")
    [ -n "$AUTHOR" ]      && gh_args+=(--author "$AUTHOR")
    [ -n "$LABEL" ]       && gh_args+=(--label "$LABEL")
    [ -n "$BASE_BRANCH" ] && gh_args+=(--base "$BASE_BRANCH")
    [ -n "$HEAD_BRANCH" ] && gh_args+=(--head "$HEAD_BRANCH")

    log_verbose "Listing PRs (state=$STATE limit=$LIMIT)"

    if [ "$OUTPUT_FORMAT" = "table" ]; then
        if ! gh pr list "${gh_args[@]}"; then
            log_error "Failed to list PRs"
            exit 1
        fi
        return 0
    fi

    local json
    if ! json=$(gh pr list "${gh_args[@]}" --json "$DEFAULT_FIELDS" 2>/dev/null); then
        log_error "Failed to list PRs"
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
    case "${1:-}" in
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
            --table)
                OUTPUT_FORMAT="table"
                shift
                ;;
            -s|--state)
                STATE="$2"
                shift 2
                ;;
            -a|--author)
                AUTHOR="$2"
                shift 2
                ;;
            -l|--label)
                LABEL="$2"
                shift 2
                ;;
            --base)
                BASE_BRANCH="$2"
                shift 2
                ;;
            --head)
                HEAD_BRANCH="$2"
                shift 2
                ;;
            --limit)
                if ! [[ "$2" =~ ^[0-9]+$ ]]; then
                    log_error "Invalid limit: $2 (must be numeric)"
                    exit 1
                fi
                LIMIT="$2"
                shift 2
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
                log_error "Unexpected argument: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done

    # Validate state
    case "$STATE" in
        open|closed|merged|all) ;;
        *)
            log_error "Invalid state: $STATE (must be open, closed, merged, or all)"
            exit 1
            ;;
    esac

    check_target_repo

    list_prs
}

main "$@"
