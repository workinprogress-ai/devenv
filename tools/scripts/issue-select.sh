#!/bin/bash
# issue-select.sh - Interactive issue selection with fzf
# Version: 1.0.0
# Description: Browse and select issues interactively using fzf for use in other scripts
# Requirements: Bash 4.0+, gh CLI, fzf
# Author: WorkInProgress.ai
# Last Modified: 2026-01-01

set -euo pipefail
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/fzf-selection.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME

# ============================================================================
# Global Variables
# ============================================================================

FILTER_STATE="open"
FILTER_TYPE=""
FILTER_MILESTONE=""
FILTER_LABEL=""
OUTPUT_FORMAT="number"
MULTI_SELECT=0
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

Interactive GitHub issue selection using fzf.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output

Filters:
    -s, --state STATE           Filter by state: open, closed, or all (default: open)
    -t, --type TYPE             Filter by type: epic, story, or bug
    -m, --milestone NAME        Filter by milestone
    -l, --label LABEL           Filter by label

Selection:
    -M, --multi                 Enable multi-select mode (use TAB to select multiple)
    -f, --format FORMAT         Output format: number, url, or json (default: number)
    --devenv                    Safety override to select issues in devenv repo

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)

Output:
    Prints selected issue number(s) to stdout, one per line.
    Returns exit code 1 if selection is cancelled.

Examples:
    # Select any open issue
    $SCRIPT_NAME

    # Select from bugs only
    $SCRIPT_NAME --type bug

    # Select from current sprint
    $SCRIPT_NAME --milestone "Sprint 5"

    # Multi-select mode
    $SCRIPT_NAME --multi

    # Use in other scripts
    issue_num=\$($SCRIPT_NAME --type story)
    gh issue view "\$issue_num"

    # Assign multiple issues
    for issue in \$($SCRIPT_NAME --multi); do
        gh issue edit "\$issue" --add-assignee "@me"
    done

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@" >&2
    fi
}

# Get issues with formatted display using library function
get_issues() {
    # Use library function to get formatted issues
    get_issues_for_selection "$FILTER_STATE" "$FILTER_TYPE" "$FILTER_LABEL" "$FILTER_MILESTONE"
}

# Interactive selection with fzf
select_issues() {
    # Check fzf is installed
    check_fzf_installed || return 1
    
    # Get issues
    local issues
    issues=$(get_issues)
    
    if [ -z "$issues" ]; then
        log_error "No issues found matching the filters"
        return 1
    fi
    
    # Build preview command
    local preview_cmd="gh issue view {1} 2>/dev/null || echo 'Loading...'"
    
    # Select using fzf library - use multi or single based on flag
    local selected
    if [ "$MULTI_SELECT" -eq 1 ]; then
        selected=$(echo "$issues" | fzf_select_multi "$issues" "Select issue(s)" "$preview_cmd")
    else
        selected=$(echo "$issues" | fzf_select_single "$issues" "Select issue" "$preview_cmd")
    fi
    
    # Validate selection
    if ! fzf_validate_selection "$selected" "issue"; then
        return 1
    fi
    
    # Extract issue numbers and format output
    echo "$selected" | while IFS=$'\t' read -r issue_info _; do
        local issue_num
        issue_num=$(echo "$issue_info" | grep -oP '#\K\d+')
        
        case "$OUTPUT_FORMAT" in
            number)
                echo "$issue_num"
                ;;
            url)
                gh issue view "$issue_num" --json url -q .url
                ;;
            json)
                gh issue view "$issue_num" --json number,title,url,state,labels
                ;;
            *)
                echo "$issue_num"
                ;;
        esac
    done
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
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
            -m|--milestone)
                FILTER_MILESTONE="$2"
                shift 2
                ;;
            -l|--label)
                FILTER_LABEL="$2"
                shift 2
                ;;
            -M|--multi)
                MULTI_SELECT=1
                shift
                ;;
            -f|--format)
                OUTPUT_FORMAT="$2"
                shift 2
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
    
    # Run interactive selection
    select_issues
}

# Run main function
main "$@"
