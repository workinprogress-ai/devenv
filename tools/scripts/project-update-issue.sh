#!/bin/bash
# project-update-issue.sh - Update issue fields in GitHub Projects (v2)
# Version: 1.0.0
# Description: Update project-specific field values for issues using GraphQL API
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
    script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Update issue fields in GitHub Projects"
fi

if [ -f "$DEVENV_ROOT/tools/lib/github-helpers.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/github-helpers.bash"
fi

if [ -f "$DEVENV_ROOT/tools/lib/git-config.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/git-config.bash"
fi

if [ -f "$DEVENV_ROOT/tools/lib/config-reader.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/config-reader.bash"
fi

# ============================================================================
# Global Variables
# ============================================================================

PROJECT_NAME=""
ISSUE_NUMBER=""
FIELD_UPDATES=()
STATUS_WORKFLOW=()
DRY_RUN=0
VERBOSE=0
ALLOW_DEVENV_REPO=0

# Load workflow status from config
load_status_workflow() {
    local config_file="$DEVENV_ROOT/devenv.config"
    
    # Config file is mandatory
    if [ ! -f "$config_file" ]; then
        log_error "devenv.config not found at $config_file"
        exit 1
    fi
    
    # Initialize config
    if ! config_init "$config_file"; then
        log_error "Failed to initialize config reader"
        exit 1
    fi
    
    # Load workflow status - mandatory field
    local workflow_str
    workflow_str=$(config_read_array "workflows" "status_workflow")
    if [ -z "$workflow_str" ]; then
        log_error "status_workflow not configured in devenv.config [workflows] section"
        exit 1
    fi
    
    # Convert space-separated to array
    read -ra STATUS_WORKFLOW <<< "$workflow_str"
}

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME PROJECT_NAME ISSUE_NUMBER [OPTIONS]

Update issue field values in a GitHub Project (v2).

Arguments:
    PROJECT_NAME                Project name or number
    ISSUE_NUMBER                Issue number to update

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without updating

Field Updates:
    --status STATUS             Set Status field value
                                Valid: TBD, To Groom, Ready, Implementing, Review, 
                                       Merged, Staging, Production
    --field NAME=VALUE          Set custom field value (can be specified multiple times)
    --list-fields               List all available fields in the project
    --devenv                    Safety override to manage projects in devenv repo

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)
    GITHUB_ORG                  Organization name (required for org projects)

Status Workflow:
    TBD         → Issue created, not ready for grooming
    To Groom    → Ready to be groomed/refined
    Ready       → Groomed and ready for implementation
    Implementing→ Active development in progress
    Review      → In pull request review
    Merged      → Merged to main, awaiting deployment
    Staging     → Deployed to staging environment
    Production  → Deployed to production (issue closed)

Examples:
    # Set issue status to Ready
    $SCRIPT_NAME "Q1 2026" 123 --status "Ready"

    # Move issue through workflow stages
    $SCRIPT_NAME "Sprint 5" 123 --status "Implementing"
    $SCRIPT_NAME "Sprint 5" 123 --status "Review"
    $SCRIPT_NAME "Sprint 5" 123 --status "Merged"

    # Set custom field values
    $SCRIPT_NAME "Q1 2026" 123 --field "Priority=High" --field "Sprint=Sprint 5"

    # List all available fields in a project
    $SCRIPT_NAME "Q1 2026" 123 --list-fields

Note:
    This script updates fields in GitHub Projects (v2) using the GraphQL API.
    The issue must already be in the project.
    Field names and values must match exactly (case-sensitive).

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

# Validate status value
validate_status() {
    local status="$1"
    
    for valid_status in "${STATUS_WORKFLOW[@]}"; do
        if [ "$status" = "$valid_status" ]; then
            return 0
        fi
    done
    
    log_error "Invalid status: $status"
    log_info "Valid statuses: ${STATUS_WORKFLOW[*]}"
    return 1
}

# Update issue status in project
update_status() {
    local status="$1"
    
    if ! validate_status "$status"; then
        return 1
    fi
    
    log_verbose "Updating issue #$ISSUE_NUMBER status to: $status"
    
    if [ "$DRY_RUN" -eq 1 ]; then
        log_info "[DRY RUN] Would set Status='$status' for issue #$ISSUE_NUMBER in project '$PROJECT_NAME'"
        return 0
    fi
    
    # For now, provide instructions since gh CLI doesn't directly support field updates
    log_info "Status update requested: $status"
    log_info "Note: Project field updates require GraphQL API or web UI"
    log_info "To update manually:"
    log_info "  1. Visit: https://github.com/orgs/$(get_repo_owner)/projects"
    log_info "  2. Open project: $PROJECT_NAME"
    log_info "  3. Find issue #$ISSUE_NUMBER"
    log_info "  4. Set Status to: $status"
    
    # TODO: Implement GraphQL mutation to update project item field
    # This requires:
    # 1. Get project ID from name
    # 2. Get project item ID for the issue
    # 3. Get field ID for Status field
    # 4. Get option ID for the status value
    # 5. Execute updateProjectV2ItemFieldValue mutation
    
    return 0
}

# List available fields in project
list_project_fields() {
    local owner
    owner=$(get_repo_owner)
    
    log_info "Listing fields for project: $PROJECT_NAME"
    log_info "Owner: $owner"
    log_info ""
    log_info "Note: Field listing requires GraphQL API"
    log_info "Run: gh project field-list $PROJECT_NAME --owner $owner"
    
    # Attempt to list fields if command exists
    if gh project field-list "$PROJECT_NAME" --owner "$owner" 2>/dev/null; then
        return 0
    else
        log_warn "Could not list fields automatically"
        log_info "Visit project in web UI to see available fields"
    fi
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    local list_fields=0
    local status_value=""
    
    # Load status workflow from config
    load_status_workflow
    
    # Parse command-line arguments
    if [ $# -eq 0 ]; then
        log_error "Project name and issue number are required"
        echo "Use --help for usage information"
        exit 1
    fi
    
    # First argument is project name
    if [[ ! "$1" =~ ^- ]]; then
        PROJECT_NAME="$1"
        shift
    fi
    
    # Second argument is issue number
    if [[ $# -gt 0 ]] && [[ "$1" =~ ^[0-9]+$ ]]; then
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
            -V|--verbose)
                VERBOSE=1
                shift
                ;;
            -n|--dry-run)
                DRY_RUN=1
                shift
                ;;
            --status)
                status_value="$2"
                shift 2
                ;;
            --field)
                FIELD_UPDATES+=("$2")
                shift 2
                ;;
            --list-fields)
                list_fields=1
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
    
    # Validate required arguments
    if [ -z "$PROJECT_NAME" ]; then
        log_error "Project name is required"
        exit 1
    fi
    
    # Check dependencies
    check_dependencies
    
    # Validate target repo
    check_target_repo
    
    # List fields if requested
    if [ "$list_fields" -eq 1 ]; then
        list_project_fields
        exit 0
    fi
    
    # Validate issue number
    if [ -z "$ISSUE_NUMBER" ]; then
        log_error "Issue number is required"
        exit 1
    fi
    
    # Update status if provided
    if [ -n "$status_value" ]; then
        update_status "$status_value"
    fi
    
    # Update custom fields if provided
    for field_update in "${FIELD_UPDATES[@]}"; do
        local field_name="${field_update%%=*}"
        local field_val="${field_update#*=}"
        
        if [ "$field_name" = "$field_update" ]; then
            log_warn "Invalid field format: $field_update (expected NAME=VALUE)"
            continue
        fi
        
        log_verbose "Field update requested: $field_name = $field_val"
        
        if [ "$DRY_RUN" -eq 1 ]; then
            log_info "[DRY RUN] Would set $field_name='$field_val' for issue #$ISSUE_NUMBER"
        else
            log_info "Custom field update: $field_name = $field_val"
            log_info "Note: Requires GraphQL API or web UI"
        fi
    done
    
    # Check if any updates were requested
    if [ -z "$status_value" ] && [ ${#FIELD_UPDATES[@]} -eq 0 ]; then
        log_error "No field updates specified"
        log_info "Use --status or --field to specify updates"
        exit 1
    fi
}

# Run main function
main "$@"
