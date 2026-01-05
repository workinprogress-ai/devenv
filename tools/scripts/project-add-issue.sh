#!/bin/bash
# project-add-issue.sh - Add issues to GitHub Projects (v2)
# Version: 1.0.0
# Description: Add one or more issues to a GitHub Project with optional field values
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
    script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Add issues to GitHub Projects"
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

PROJECT_NAME=""
ISSUE_NUMBERS=()
FIELD_VALUES=()
DRY_RUN=0
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME PROJECT_NAME ISSUE_NUMBER... [OPTIONS]

Add issues to a GitHub Project (v2).

Arguments:
    PROJECT_NAME                Project name or number
    ISSUE_NUMBER                Issue number(s) to add (can specify multiple)

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without adding issues

    --field NAME=VALUE          Set project field value (can be specified multiple times)
                                Example: --field "Status=Ready" --field "Priority=High"
    --devenv                    Safety override to manage projects in devenv repo

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)
    GITHUB_ORG                  Organization name (required for org projects)

Examples:
    # Add single issue to project
    $SCRIPT_NAME "Q1 2026" 123

    # Add multiple issues to project
    $SCRIPT_NAME "Q1 2026" 123 124 125

    # Add issue with field values
    $SCRIPT_NAME "Q1 2026" 123 --field "Status=Ready" --field "Priority=High"

    # Add multiple issues with same field values
    $SCRIPT_NAME "Sprint 5" 123 124 \\
        --field "Status=To Groom" --field "Sprint=Sprint 5"

Note:
    This script adds issues to GitHub Projects (v2). The project must already exist.
    Use 'gh project list' to see available projects.
    Field values must match existing field options in the project.

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

# Get the owner (org or user)
get_owner() {
    if [ -n "${GITHUB_ORG:-}" ]; then
        echo "$GITHUB_ORG"
    else
        local repo_spec=""
        local repo_name
        repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
        if [ -n "$repo_name" ]; then
            repo_spec="-R $repo_name"
        fi
        gh repo view $repo_spec --json owner -q .owner.login
    fi
}

# Get issue URL
get_issue_url() {
    local issue_num="$1"
    local repo_spec=""
    if [ -n "${GITHUB_ORG:-}" ]; then
        local repo_name
        repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
        if [ -n "$repo_name" ]; then
            repo_spec="-R ${GITHUB_ORG}/${repo_name}"
        fi
    fi
    gh issue view $repo_spec "$issue_num" --json url -q .url
}

# Add issue to project
add_issue_to_project() {
    local issue_num="$1"
    local owner
    owner=$(get_repo_owner)
    
    local issue_url
    issue_url=$(get_issue_url "$issue_num")
    
    if [ -z "$issue_url" ]; then
        log_error "Could not get URL for issue #$issue_num"
        return 1
    fi
    
    if [ "$DRY_RUN" -eq 1 ]; then
        log_info "[DRY RUN] Would add issue #$issue_num to project '$PROJECT_NAME'"
        return 0
    fi
    
    log_verbose "Adding issue #$issue_num to project '$PROJECT_NAME'"
    
    # Add issue to project
    if gh project item-add "$PROJECT_NAME" --owner "$owner" --url "$issue_url" &> /dev/null; then
        log_info "Added issue #$issue_num to project '$PROJECT_NAME'"
        
        # Set field values if provided
        if [ ${#FIELD_VALUES[@]} -gt 0 ]; then
            set_field_values "$issue_num" "$owner"
        fi
        
        return 0
    else
        log_error "Failed to add issue #$issue_num to project '$PROJECT_NAME'"
        log_info "Check that the project exists and you have permissions"
        return 1
    fi
}

# Set field values for issue in project
set_field_values() {
    local issue_num="$1"
    local owner="$2"
    
    for field_value in "${FIELD_VALUES[@]}"; do
        # Parse field name and value
        local field_name="${field_value%%=*}"
        local field_val="${field_value#*=}"
        
        if [ "$field_name" = "$field_value" ]; then
            log_warn "Invalid field format: $field_value (expected NAME=VALUE)"
            continue
        fi
        
        log_verbose "Setting field '$field_name' to '$field_val' for issue #$issue_num"
        
        # Note: gh CLI doesn't have a direct command to set project item fields yet
        # This would require using the GraphQL API directly
        # For now, log a message
        log_warn "Field setting requires manual configuration or GraphQL API"
        log_info "Field: $field_name = $field_val (for issue #$issue_num)"
    done
}

# Process all issues
process_issues() {
    local failed=0
    
    for issue_num in "${ISSUE_NUMBERS[@]}"; do
        if ! add_issue_to_project "$issue_num"; then
            failed=$((failed + 1))
        fi
    done
    
    if [ "$failed" -gt 0 ]; then
        log_error "Failed to add $failed issue(s)"
        return 1
    fi
    
    return 0
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    # Parse command-line arguments
    if [ $# -eq 0 ]; then
        log_error "Project name and at least one issue number are required"
        echo "Use --help for usage information"
        exit 1
    fi
    
    # First argument is project name
    PROJECT_NAME="$1"
    shift
    
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
            --field)
                FIELD_VALUES+=("$2")
                shift 2
                ;;
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
                ALLOW_DEVENV_REPO=1
                shift
                ;;
            *)
                # Assume it's an issue number using library validation
                if validate_numeric "$1" && [ "$1" -gt 0 ]; then
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
    if [ -z "$PROJECT_NAME" ]; then
        log_error "Project name is required"
        exit 1
    fi
    
    if [ ${#ISSUE_NUMBERS[@]} -eq 0 ]; then
        log_error "At least one issue number is required"
        exit 1
    fi
    
    # Check dependencies
    check_dependencies
    
    # Validate target repo
    check_target_repo
    
    # Process the issues
    process_issues
}

# Run main function
main "$@"
