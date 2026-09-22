#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# project-update-issue.sh - Update issue fields in GitHub Projects (v2)
# Version: 1.0.0
# Description: Update project-specific field values for issues using GraphQL API
# Requirements: Bash 4.0+, gh CLI, jq
# Author: WorkInProgress.ai
# Last Modified: 2026-01-01

set -euo pipefail
# shellcheck disable=SC2034  # VERBOSE is written here; read by log_verbose in error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/config-reader.bash"
#
# Org identity (policy_org) arrives transitively via github-helpers
# (which loads the policy layer); no explicit policy sourcing here.

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Update GitHub Project issues"

# ============================================================================
# Global Variables
# ============================================================================

PROJECT_NAME=""
ISSUE_NUMBER=""
FIELD_UPDATES=()
ALL_PROJECTS=0
SAFE_MODE=0
STATUS_WORKFLOW=()
DRY_RUN=0
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
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
    
    # config_read_array normalizes the comma-separated config value to a
    # space-separated token stream; vocabulary tokens are hyphenated
    # single words (no spaces), so whitespace splitting is exact.
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
    --all-projects              Fan the status update out to EVERY project
                                containing the issue (strict: errors when the
                                issue is in no projects)
    --safe                      With --all-projects: zero membership becomes a
                                no-op success (used by skill event scripts)
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

# Get the owner (org or user)
get_owner() {
    local policy_org
    policy_org="${GITHUB_ORG:-}"
    [ -z "$policy_org" ] && policy_org="$(policy_org 2>/dev/null || true)"
    if [ -n "$policy_org" ]; then
        echo "$policy_org"
    else
        local repo_spec=""
        local repo_name
        repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
        if [ -n "$repo_name" ]; then
            repo_spec="-R $repo_name"
        fi
        provider_repos_view "${repo_spec#-R }" --json owner -q .owner.login
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

# Update issue status in EVERY project containing the issue (fan-out).
# Strict by default: zero membership is an error. --safe downgrades that to
# a no-op success (skills always pass --safe). Projects without a Status
# field are skipped and reported; exit 0 when at least one project updated.
update_status_all_projects() {
    local status="$1"

    local repo_spec owner repo issue_url
    repo_spec=$(resolve_target_repo) || return 1
    owner="${repo_spec%%/*}"
    repo="${repo_spec#*/}"
    issue_url="https://github.com/$owner/$repo/issues/$ISSUE_NUMBER"

    # Reverse lookup: all containing projects + current status.
    # A lookup FAILURE is distinct from zero membership: fail the run
    # (strict) or report-and-fail (--safe never lies about success).
    local projects
    if ! projects=$(projects_for_issue "$issue_url" "$owner"); then
        if [ "$SAFE_MODE" -eq 1 ]; then
            log_warn "project lookup failed for issue #$ISSUE_NUMBER - skipping status update (--safe reports, never lies)"
        else
            log_error "project lookup failed for issue #$ISSUE_NUMBER"
        fi
        return 1
    fi

    if [ -z "$projects" ]; then
        if [ "$SAFE_MODE" -eq 1 ]; then
            log_info "Issue #$ISSUE_NUMBER is in no projects - nothing to update (--safe)"
            return 0
        fi
        log_error "Issue #$ISSUE_NUMBER is in no projects (use --safe to tolerate this)"
        return 1
    fi

    local updated=0 failed=0
    while IFS=$'\t' read -r proj_title proj_num proj_status; do
        [ -n "$proj_title" ] || continue
        if [ "$proj_status" = "$status" ]; then
            log_info "Project '$proj_title' ($proj_num): already Status='$status' (idempotent skip)"
            ((++updated))
            continue
        fi
        # Route through the single-project path for the actual write.
        PROJECT_NAME="$proj_num"
        if update_status "$status"; then
            ((++updated))
        else
            ((++failed))
        fi
    done <<< "$projects"

    if [ "$updated" -eq 0 ]; then
        log_error "No project updated for issue #$ISSUE_NUMBER (updated=$updated failed=$failed)"
        return 1
    fi
    [ "$failed" -gt 0 ] && log_warn "Partial: updated=$updated failed=$failed for issue #$ISSUE_NUMBER"
    return 0
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
    
    # Real write path: resolve IDs (project, item, field, option) and mutate.
    local repo_spec owner repo issue_url
    repo_spec=$(resolve_target_repo) || return 1
    owner="${repo_spec%%/*}"
    repo="${repo_spec#*/}"
    issue_url="https://github.com/$owner/$repo/issues/$ISSUE_NUMBER"

    local project_id item_id field_id option_id
    project_id=$(project_id_by_name "$owner" "$PROJECT_NAME") || {
        log_error "Project '$PROJECT_NAME' not found for owner '$owner'"
        return 1
    }
    item_id=$(project_item_id_for_issue "$project_id" "$ISSUE_NUMBER") || {
        log_error "Issue #$ISSUE_NUMBER is not in project '$PROJECT_NAME'"
        return 1
    }
    field_id=""
    option_id=""
    read -r field_id option_id <<< "$(project_field_and_option_ids "$project_id" "Status" "$status")"
    if [ -z "$field_id" ] || [ -z "$option_id" ]; then
        log_error "Status option '$status' not found in project '$PROJECT_NAME'"
        return 1
    fi

    update_project_item_field "$project_id" "$item_id" "$field_id" "$option_id" || {
        log_error "Failed to set Status='$status' for issue #$ISSUE_NUMBER in '$PROJECT_NAME'"
        return 1
    }
    log_info "Set Status='$status' for issue #$ISSUE_NUMBER in project '$PROJECT_NAME'"
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
    log_info "Run: provider_projects_field_list $PROJECT_NAME --owner $owner"
    
    # Attempt to list fields if command exists
    if provider_projects_field_list "" "$PROJECT_NAME" --owner "$owner" 2>/dev/null; then
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
    POSITIONAL_ARGS=()
    
    # Load status workflow from config
    load_status_workflow
    
    # Parse command-line arguments
    if [ $# -eq 0 ]; then
        log_error "Project name and issue number are required"
        echo "Use --help for usage information"
        exit 1
    fi
    
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                show_usage
                ;;
            --)  # end of options: everything after is positional
                shift
                while [[ $# -gt 0 ]]; do
                    POSITIONAL_ARGS+=("$1")
                    shift
                done
                ;;
            -v|--version)
                echo "$SCRIPT_VERSION"
                exit 0
                ;;
            -V|--verbose)
                # shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
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
            --all-projects)
                ALL_PROJECTS=1
                shift
                ;;
            --safe)
                SAFE_MODE=1
                shift
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
                # Bare positionals: [PROJECT_NAME] ISSUE_NUMBER (fan-out mode
                # may pass only the issue number). Collect, don't error.
                POSITIONAL_ARGS+=("$1")
                shift
                ;;
        esac
    done
    
    # Positionals (remaining argv): [PROJECT_NAME] ISSUE_NUMBER. Under
    # --all-projects a lone numeric positional is the issue (the project is
    # discovered from the issue).
    if [[ ${#POSITIONAL_ARGS[@]} -gt 0 ]]; then
        if [[ "$ALL_PROJECTS" -eq 1 && ${#POSITIONAL_ARGS[@]} -eq 1 && "${POSITIONAL_ARGS[0]}" =~ ^[0-9]+$ ]]; then
            ISSUE_NUMBER="${POSITIONAL_ARGS[0]}"
        else
            PROJECT_NAME="${POSITIONAL_ARGS[0]}"
            if [[ ${#POSITIONAL_ARGS[@]} -gt 1 && "${POSITIONAL_ARGS[1]}" =~ ^[0-9]+$ ]]; then
                ISSUE_NUMBER="${POSITIONAL_ARGS[1]}"
            fi
        fi
    fi

    # Validate required arguments (single-project mode needs PROJECT_NAME;
    # --all-projects discovers projects from the issue so it does not).
    if [ "$ALL_PROJECTS" -ne 1 ] && [ -z "$PROJECT_NAME" ]; then
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
    
    # Update status if provided (fan-out or single-project)
    if [ -n "$status_value" ]; then
        if [ "$ALL_PROJECTS" -eq 1 ]; then
            update_status_all_projects "$status_value"
        else
            update_status "$status_value"
        fi
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
