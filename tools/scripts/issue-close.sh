#!/bin/bash
# issue-close.sh - Close or reopen GitHub issues
# Version: 1.0.0
# Description: Close or reopen issues with optional comment and reason
# Requirements: Bash 4.0+, gh CLI
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
    script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Close/reopen GitHub issues"
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

ISSUE_NUMBERS=()
ACTION="close"
COMMENT=""
REASON=""
DRY_RUN=0
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [ACTION] ISSUE_NUMBER... [OPTIONS]

Close or reopen GitHub issues.

Actions:
    close                       Close issue(s) (default)
    reopen                      Reopen issue(s)

Arguments:
    ISSUE_NUMBER                Issue number(s) to close/reopen (can specify multiple)

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without doing it
    --select                    Interactively select issue(s) to close/reopen

    -c, --comment TEXT          Add comment when closing/reopening
    -r, --reason REASON         Close reason: completed or "not planned" (close only)
    --devenv                    Safety override to close issues in devenv repo

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)

Examples:
    # Close an issue
    $SCRIPT_NAME 123

    # Close multiple issues
    $SCRIPT_NAME 123 124 125

    # Close with a comment
    $SCRIPT_NAME 123 --comment "Fixed in PR #456"

    # Close as "not planned"
    $SCRIPT_NAME 123 --reason "not planned"

    # Reopen an issue
    $SCRIPT_NAME reopen 123

    # Reopen with comment
    $SCRIPT_NAME reopen 123 --comment "Need to revisit this"

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

# Verify issue exists
verify_issue() {
    local issue_num="$1"
    issue_exists --repo "$(get_repo_spec)" "$issue_num" 2>/dev/null || {
        log_error "Issue #$issue_num not found"
        return 1
    }
}

# Close an issue (wrapper around library function with dry-run support)
close_issue_local() {
    local issue_num="$1"
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"
    
    if [ "$DRY_RUN" -eq 1 ]; then
        local msg="[DRY RUN] Would close issue #$issue_num"
        [ -n "$REASON" ] && msg="$msg (reason: $REASON)"
        [ -n "$COMMENT" ] && msg="$msg (comment: $COMMENT)"
        log_info "$msg"
        return 0
    fi
    
    log_verbose "Closing issue #$issue_num"
    close_issue --repo "${repo_spec[*]}" --reason "$REASON" --comment "$COMMENT" "$issue_num"
}

# Reopen an issue (wrapper around library function with dry-run support)
reopen_issue_local() {
    local issue_num="$1"
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"
    
    if [ "$DRY_RUN" -eq 1 ]; then
        local msg="[DRY RUN] Would reopen issue #$issue_num"
        [ -n "$COMMENT" ] && msg="$msg (comment: $COMMENT)"
        log_info "$msg"
        return 0
    fi
    
    log_verbose "Reopening issue #$issue_num"
    reopen_issue --repo "${repo_spec[*]}" --comment "$COMMENT" "$issue_num"
}

# Process all issues
process_issues() {
    local failed=0
    
    for issue_num in "${ISSUE_NUMBERS[@]}"; do
        # Verify issue exists
        if ! verify_issue "$issue_num"; then
            failed=$((failed + 1))
            continue
        fi
        
        # Perform action
        case "$ACTION" in
            close)
                if ! close_issue_local "$issue_num"; then
                    failed=$((failed + 1))
                fi
                ;;
            reopen)
                if ! reopen_issue_local "$issue_num"; then
                    failed=$((failed + 1))
                fi
                ;;
        esac
    done
    
    return "$failed"
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    # Parse command-line arguments
    if [ $# -eq 0 ]; then
        log_error "At least one issue number is required"
        echo "Use --help for usage information"
        exit 1
    fi
    
    # Check for help/version first
    case "$1" in
        -h|--help)
            show_usage
            ;;
        -v|--version)
            echo "$SCRIPT_VERSION"
            exit 0
            ;;
    esac
    
    # Ensure GitHub CLI authentication
    ensure_gh_login
    
    # Check if first arg is an action
    if [[ "$1" =~ ^(close|reopen)$ ]]; then
        ACTION="$1"
        shift
    fi
    
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
            -n|--dry-run)
                DRY_RUN=1
                shift
                ;;
            --select)
                # Interactive selection based on action
                local state_filter
                if [ "$ACTION" = "close" ]; then
                    state_filter="open"
                else
                    state_filter="closed"
                fi
                
                local selected_issues
                selected_issues=$("$PROJECT_TOOLS/issue-select" --state "$state_filter" --multi)
                if [ -z "$selected_issues" ]; then
                    log_error "No issue selected"
                    exit 1
                fi
                
                # Read selected issues into array
                while IFS= read -r issue_num; do
                    ISSUE_NUMBERS+=("$issue_num")
                done <<< "$selected_issues"
                
                shift
                ;;
            -c|--comment)
                COMMENT="$2"
                shift 2
                ;;
            -r|--reason)
                REASON="$2"
                shift 2
                ;;
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
                ALLOW_DEVENV_REPO=1
                shift
                ;;
            *)
                # Assume it's an issue number
                if [[ "$1" =~ ^[0-9]+$ ]]; then
                    ISSUE_NUMBERS+=("$1")
                    shift
                else
                    log_error "Unknown option or invalid issue number: $1"
                    echo "Use --help for usage information"
                    exit 1
                fi
                ;;
        esac
    done
    
    # Validate required arguments
    if [ ${#ISSUE_NUMBERS[@]} -eq 0 ]; then
        log_error "At least one issue number is required"
        exit 1
    fi
    
    # Validate reason only applies to close
    if [ -n "$REASON" ] && [ "$ACTION" != "close" ]; then
        log_error "--reason can only be used with close action"
        exit 1
    fi
    
    # Check dependencies
    check_dependencies
    
    # Validate target repo
    check_target_repo
    
    # Process the issues
    if ! process_issues; then
        exit 1
    fi
}

# Run main function
main "$@"
