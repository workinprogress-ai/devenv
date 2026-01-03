#!/bin/bash
# issue-update.sh - Update GitHub issue fields
# Version: 1.0.0
# Description: Update issue title, body, labels, assignees, milestone, and state
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
    script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Update GitHub issues"
fi

if [ -f "$DEVENV_ROOT/tools/lib/github-helpers.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/github-helpers.bash"
fi

if [ -f "$DEVENV_ROOT/tools/lib/git-config.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/git-config.bash"
fi

# ============================================================================
# Global Variables
# ============================================================================

ISSUE_NUMBER=""
NEW_TITLE=""
NEW_BODY=""
NEW_BODY_FILE=""
ADD_LABELS=()
REMOVE_LABELS=()
ADD_ASSIGNEES=()
REMOVE_ASSIGNEES=()
NEW_MILESTONE=""
NEW_STATE=""
DRY_RUN=0
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME ISSUE_NUMBER [OPTIONS]

Update a GitHub issue's fields.

Arguments:
    ISSUE_NUMBER                Issue number to update

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without updating
    --select                    Interactively select an issue to update

Updates:
    -t, --title TITLE           Update issue title
    -b, --body TEXT             Update issue body/description
    -f, --body-file FILE        Read new body from file (markdown)
    --add-label LABEL           Add label (can be specified multiple times)
    --remove-label LABEL        Remove label (can be specified multiple times)
    --add-assignee USER         Add assignee (can be specified multiple times)
    --remove-assignee USER      Remove assignee (can be specified multiple times)
    -m, --milestone NAME        Set milestone (use "" to clear)
    -s, --state STATE           Set state: open or closed
    --devenv                    Safety override to update issues in devenv repo

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)

Examples:
    # Update issue title
    $SCRIPT_NAME 123 --title "New title"

    # Add labels and assignee
    $SCRIPT_NAME 123 --add-label "priority:high" --add-assignee "john"

    # Remove a label
    $SCRIPT_NAME 123 --remove-label "wontfix"

    # Update body from file
    $SCRIPT_NAME 123 --body-file updated-description.md

    # Change milestone
    $SCRIPT_NAME 123 --milestone "Sprint 6"

    # Close an issue
    $SCRIPT_NAME 123 --state closed

    # Combined update
    $SCRIPT_NAME 123 --add-label "type:bug" --add-assignee "@me" \\
        --milestone "Sprint 5" --title "Updated title"

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
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"
    
    if ! gh issue view "${repo_spec[@]}" "$issue_num" &> /dev/null; then
        log_error "Issue #$issue_num not found"
        exit 1
    fi
}

# Update issue fields
update_issue() {
    local gh_args=()
    local has_updates=0
    
    # Title update
    if [ -n "$NEW_TITLE" ]; then
        gh_args+=(--title "$NEW_TITLE")
        has_updates=1
        log_verbose "Will update title to: $NEW_TITLE"
    fi
    
    # Body update
    if [ -n "$NEW_BODY" ]; then
        gh_args+=(--body "$NEW_BODY")
        has_updates=1
        log_verbose "Will update body"
    elif [ -n "$NEW_BODY_FILE" ]; then
        gh_args+=(--body-file "$NEW_BODY_FILE")
        has_updates=1
        log_verbose "Will update body from file: $NEW_BODY_FILE"
    fi
    
    # Add labels
    for label in "${ADD_LABELS[@]}"; do
        gh_args+=(--add-label "$label")
        has_updates=1
        log_verbose "Will add label: $label"
    done
    
    # Remove labels
    for label in "${REMOVE_LABELS[@]}"; do
        gh_args+=(--remove-label "$label")
        has_updates=1
        log_verbose "Will remove label: $label"
    done
    
    # Add assignees
    for assignee in "${ADD_ASSIGNEES[@]}"; do
        gh_args+=(--add-assignee "$assignee")
        has_updates=1
        log_verbose "Will add assignee: $assignee"
    done
    
    # Remove assignees
    for assignee in "${REMOVE_ASSIGNEES[@]}"; do
        gh_args+=(--remove-assignee "$assignee")
        has_updates=1
        log_verbose "Will remove assignee: $assignee"
    done
    
    # Milestone update
    if [ -n "$NEW_MILESTONE" ]; then
        gh_args+=(--milestone "$NEW_MILESTONE")
        has_updates=1
        log_verbose "Will set milestone to: $NEW_MILESTONE"
    fi
    
    # Check if any updates were specified
    if [ "$has_updates" -eq 0 ] && [ -z "$NEW_STATE" ]; then
        log_error "No updates specified"
        echo "Use --help for usage information"
        exit 1
    fi
    
    # Execute updates via gh issue edit
    if [ "$has_updates" -eq 1 ]; then
        local repo_spec
        read -ra repo_spec <<< "$(get_repo_spec)"
        if [ "$DRY_RUN" -eq 1 ]; then
            log_info "[DRY RUN] Would run: gh issue edit ${repo_spec[*]} $ISSUE_NUMBER ${gh_args[*]}"
        else
            log_verbose "Running: gh issue edit ${repo_spec[*]} $ISSUE_NUMBER ${gh_args[*]}"
            if gh issue edit "${repo_spec[@]}" "$ISSUE_NUMBER" "${gh_args[@]}"; then
                log_info "Updated issue #$ISSUE_NUMBER"
            else
                log_error "Failed to update issue #$ISSUE_NUMBER"
                return 1
            fi
        fi
    fi
    
    # Handle state change separately (close/reopen)
    if [ -n "$NEW_STATE" ]; then
        local repo_spec
        read -ra repo_spec <<< "$(get_repo_spec)"
        case "$NEW_STATE" in
            closed|close)
                if [ "$DRY_RUN" -eq 1 ]; then
                    log_info "[DRY RUN] Would close issue #$ISSUE_NUMBER"
                else
                    log_verbose "Closing issue #$ISSUE_NUMBER"
                    if gh issue close "${repo_spec[@]}" "$ISSUE_NUMBER"; then
                        log_info "Closed issue #$ISSUE_NUMBER"
                    else
                        log_error "Failed to close issue #$ISSUE_NUMBER"
                        return 1
                    fi
                fi
                ;;
            open|reopen)
                if [ "$DRY_RUN" -eq 1 ]; then
                    log_info "[DRY RUN] Would reopen issue #$ISSUE_NUMBER"
                else
                    log_verbose "Reopening issue #$ISSUE_NUMBER"
                    if gh issue reopen "${repo_spec[@]}" "$ISSUE_NUMBER"; then
                        log_info "Reopened issue #$ISSUE_NUMBER"
                    else
                        log_error "Failed to reopen issue #$ISSUE_NUMBER"
                        return 1
                    fi
                fi
                ;;
            *)
                log_error "Invalid state: $NEW_STATE (must be open or closed)"
                exit 1
                ;;
        esac
    fi
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    # Parse command-line arguments
    if [ $# -eq 0 ]; then
        log_error "Issue number is required"
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
    
    # First argument should be issue number (unless it's a flag)
    if [[ "$1" =~ ^[0-9]+$ ]]; then
        ISSUE_NUMBER="$1"
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
            --select)
                # Interactive selection (show all issues by default)
                ISSUE_NUMBER=$("$PROJECT_ROOT/scripts/issue-select.sh" --state all)
                if [ -z "$ISSUE_NUMBER" ]; then
                    log_error "No issue selected"
                    exit 1
                fi
                shift
                ;;
            -V|--verbose)
                VERBOSE=1
                shift
                ;;
            -n|--dry-run)
                DRY_RUN=1
                shift
                ;;
            -t|--title)
                NEW_TITLE="$2"
                shift 2
                ;;
            -b|--body)
                NEW_BODY="$2"
                shift 2
                ;;
            -f|--body-file)
                if [ ! -f "$2" ]; then
                    log_error "Body file not found: $2"
                    exit 1
                fi
                NEW_BODY_FILE="$2"
                shift 2
                ;;
            --add-label)
                ADD_LABELS+=("$2")
                shift 2
                ;;
            --remove-label)
                REMOVE_LABELS+=("$2")
                shift 2
                ;;
            --add-assignee)
                ADD_ASSIGNEES+=("$2")
                shift 2
                ;;
            --remove-assignee)
                REMOVE_ASSIGNEES+=("$2")
                shift 2
                ;;
            -m|--milestone)
                NEW_MILESTONE="$2"
                shift 2
                ;;
            -s|--state)
                NEW_STATE="$2"
                shift 2
                ;;
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
                ALLOW_DEVENV_REPO=1
                shift
                ;;
            *)
                # Check if this is the issue number
                if [[ "$1" =~ ^[0-9]+$ ]] && [ -z "$ISSUE_NUMBER" ]; then
                    ISSUE_NUMBER="$1"
                    shift
                else
                    log_error "Unknown option: $1"
                    echo "Use --help for usage information"
                    exit 1
                fi
                ;;
        esac
    done
    
    # Validate required arguments
    if [ -z "$ISSUE_NUMBER" ]; then
        log_error "Issue number is required"
        exit 1
    fi
    
    # Check dependencies
    check_dependencies
    
    # Validate target repo
    check_target_repo
    
    # Verify issue exists
    verify_issue "$ISSUE_NUMBER"
    
    # Update the issue
    update_issue
}

# Run main function
main "$@"
