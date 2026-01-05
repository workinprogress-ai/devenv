#!/bin/bash
# issue-list.sh - List and filter GitHub issues
# Version: 1.0.0
# Description: Query and filter GitHub issues with support for labels, assignees,
#              milestones, state, and custom formatting
# Requirements: Bash 4.0+, gh CLI, jq
# Author: WorkInProgress.ai
# Last Modified: 2026-01-01

set -euo pipefail

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
# Source required libraries
if [ -f "$DEVENV_ROOT/tools/lib/error-handling.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/error-handling.bash"
fi

if [ -f "$DEVENV_ROOT/tools/lib/versioning.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/versioning.bash"
    script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "List GitHub issues"
fi

if [ -f "$DEVENV_ROOT/tools/lib/github-helpers.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/github-helpers.bash"
fi

if [ -f "$DEVENV_ROOT/tools/lib/git-config.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/git-config.bash"
fi

if [ -f "$DEVENV_ROOT/tools/lib/issue-operations.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/issue-operations.bash"
fi

# ============================================================================
# Global Variables
# ============================================================================

FILTER_STATE="open"
FILTER_LABELS=()
FILTER_ASSIGNEE=""
FILTER_MILESTONE=""
FILTER_TYPE=""
OUTPUT_FORMAT="table"
LIMIT=30
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

List and filter GitHub issues.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output

Filters:
    -s, --state STATE           Filter by state: open, closed, or all (default: open)
    -t, --type TYPE             Filter by type: epic, story, or bug
    -l, --label LABEL           Filter by label (can be specified multiple times)
    -a, --assignee USER         Filter by assignee (use "none" for unassigned)
    -m, --milestone NAME        Filter by milestone (use "none" for no milestone)
    --author USER               Filter by author
    --mention USER              Filter by mentioned user

Output:
    -f, --format FORMAT         Output format: table, json, simple (default: table)
    -n, --limit NUMBER          Limit number of results (default: 30)
    --web                       Open results in web browser
    --devenv                    Safety override to list issues in devenv repo

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)

Examples:
    # List all open issues
    $SCRIPT_NAME

    # List all bugs in "Sprint 5" milestone
    $SCRIPT_NAME --type bug --milestone "Sprint 5"

    # List all epics (open and closed)
    $SCRIPT_NAME --type epic --state all

    # List issues assigned to me
    $SCRIPT_NAME --assignee @me

    # List unassigned high-priority bugs
    $SCRIPT_NAME --type bug --assignee none --label "priority:high"

    # List issues in JSON format for scripting
    $SCRIPT_NAME --format json --limit 100

    # Open issue list in browser
    $SCRIPT_NAME --type story --milestone "Sprint 5" --web

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

# List issues using library filters
list_issues() {
    local gh_args=()
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"
    
    # Add repository specification
    gh_args+=("${repo_spec[@]}")
    
    # Build filter arguments using library function
    local filter_string
    filter_string=$(build_issue_filters --state "$FILTER_STATE" --type "$FILTER_TYPE" --limit "$LIMIT") || exit 1
    read -ra filter_args <<< "$filter_string"
    gh_args+=("${filter_args[@]}")
    
    # Add label filters (not in library function yet - custom handling)
    for label in "${FILTER_LABELS[@]}"; do
        gh_args+=(--label "$label")
    done
    
    # Add assignee if specified
    if [ -n "$FILTER_ASSIGNEE" ]; then
        gh_args+=(--assignee "$FILTER_ASSIGNEE")
    fi
    
    # Add milestone if specified
    if [ -n "$FILTER_MILESTONE" ]; then
        gh_args+=(--milestone "$FILTER_MILESTONE")
    fi
    
    # Set output format
    case "$OUTPUT_FORMAT" in
        table)
            log_verbose "Listing issues in table format"
            ;;
        json)
            # shellcheck disable=SC2054  # gh CLI uses comma-separated fields
            gh_args+=(--json number,title,state,labels,assignees,milestone,createdAt,updatedAt,url)
            log_verbose "Listing issues in JSON format"
            ;;
        simple)
            # shellcheck disable=SC2054  # gh CLI uses comma-separated fields
            gh_args+=(--json number,title)
            log_verbose "Listing issues in simple format"
            ;;
        *)
            log_error "Invalid format: $OUTPUT_FORMAT (must be table, json, or simple)"
            exit 1
            ;;
    esac
    
    log_verbose "Running: gh issue list ${gh_args[*]}"
    
    # Execute the list command
    if [ "$OUTPUT_FORMAT" = "simple" ]; then
        gh issue list "${gh_args[@]}" | jq -r '.[] | "#\(.number) - \(.title)"'
    else
        gh issue list "${gh_args[@]}"
    fi
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    local open_web=0
    local extra_args=()
    
    # Parse command-line arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                show_usage
                ;;
            -v|--version)
                echo "$SCRIPT_VERSION"
                exit 0
                ;;
            *)
                break
                ;;
        esac
    done
    
    # Ensure GitHub CLI authentication
    ensure_gh_login
    
    # Continue parsing other arguments
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
            -s|--state)
                FILTER_STATE="$2"
                shift 2
                ;;
            -t|--type)
                FILTER_TYPE="$2"
                shift 2
                ;;
            -l|--label)
                FILTER_LABELS+=("$2")
                shift 2
                ;;
            -a|--assignee)
                FILTER_ASSIGNEE="$2"
                shift 2
                ;;
            -m|--milestone)
                FILTER_MILESTONE="$2"
                shift 2
                ;;
            --author)
                extra_args+=(--author "$2")
                shift 2
                ;;
            --mention)
                extra_args+=(--mention "$2")
                shift 2
                ;;
            -f|--format)
                OUTPUT_FORMAT="$2"
                shift 2
                ;;
            -n|--limit)
                LIMIT="$2"
                shift 2
                ;;
            --web)
                open_web=1
                shift
                ;;
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
                ALLOW_DEVENV_REPO=1
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
    
    # Check dependencies
    check_dependencies
    
    # Validate target repo
    check_target_repo
    
    # Open in web if requested
    if [ "$open_web" -eq 1 ]; then
        log_info "Opening issues in web browser..."
        gh issue list --web
        exit 0
    fi
    
    # List the issues
    list_issues
}

# Run main function
main "$@"
