#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# project-add-issue.sh - Add issues to GitHub Projects (v2)
# Version: 1.0.0
# Description: Add one or more issues to a GitHub Project with optional field values
# Requirements: Bash 4.0+, gh CLI
# Author: WorkInProgress.ai
# Last Modified: 2026-01-01

set -euo pipefail
# shellcheck disable=SC2034  # VERBOSE is written here; read by log_verbose in error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/provider-loader.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/validation.bash"
source "$DEVENV_TOOLS/lib/fzf-selection.bash"
#
# Org identity (policy_org) arrives transitively via provider-loader
# (which loads the policy layer); no explicit policy sourcing here.

readonly SCRIPT_VERSION="1.1.0"
SCRIPT_NAME="$(basename "$0")"
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Add issues to GitHub Projects"
readonly SCRIPT_NAME

# ============================================================================
# Global Variables
# ============================================================================

PROJECT_NAME=""
ISSUE_NUMBERS=()
FIELD_VALUES=()
DRY_RUN=0
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
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

    --field NAME=VALUE          Set a single-select project field value (can be
                                specified multiple times)
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
        --field "Status=To-Groom" --field "Sprint=Sprint 5"

Note:
    This script adds issues to GitHub Projects (v2). The project must already exist.
    Use 'gh project list' to see available projects.
    Field values must match existing field options in the project.

EOF
    exit 0
}

# Get the owner (org or user)
get_owner() {
    local policy_org
    policy_org="$(provider_org_get 2>/dev/null || true)"
    if [ -n "$policy_org" ]; then
        echo "$policy_org"
    else
        local repo_name
        repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
        if [ -n "$repo_name" ]; then
            provider_repos_view "$repo_name" --json owner -q .owner.login
        fi
    fi
}

# Get issue URL
# Repo resolution follows the suite's canonical order via resolve_target_repo:
#   explicit override > GITHUB_REPO env > GH_ORG + cwd git root > error.
# This script previously ignored GITHUB_REPO here and resolved from the
# current directory, silently adding wrong-repo issues with matching numbers.
get_issue_url() {
    local issue_num="$1"
    local repo=""
    policy_org="$(provider_org_get 2>/dev/null || true)"
    if [ -n "$policy_org" ]; then
        local repo_name
        repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
        if [ -n "$repo_name" ]; then
            repo="${policy_org}/${repo_name}"
        fi
    fi
    provider_issues_view "$repo" "$issue_num" --json url -q .url
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
    if provider_projects_item_add "" "$PROJECT_NAME" "$issue_url" --owner "$owner" &> /dev/null; then
        log_info "Added issue #$issue_num to project '$PROJECT_NAME'"
        
        # Set field values if provided
        if [ ${#FIELD_VALUES[@]} -gt 0 ]; then
            set_field_values "$issue_num" "$owner" || return 1
        fi
        
        return 0
    else
        log_error "Failed to add issue #$issue_num to project '$PROJECT_NAME'"
        [ -n "$add_stderr" ] && log_error "gh: $add_stderr"
        log_info "Check that the project exists, you have permissions, and GITHUB_REPO/GITHUB_ORG point at the issue's repository"
        return 1
    fi
}

# Set field values for the newly added issue's project card (single-select
# fields, via the shared GraphQL helpers). All specified fields must resolve
# and write; the first failure aborts with rc=1 — never a partial silent success.
set_field_values() {
    local issue_num="$1"
    local owner="$2"
    local repo="${owner#*/}"
    owner="${owner%%/*}"

    local repo_spec
    repo_spec=$(resolve_target_repo) || return 1
    owner="${repo_spec%%/*}"
    repo="${repo_spec#*/}"

    local project_id item_id
    project_id=$(provider_projects_id_by_name "$owner" "$PROJECT_NAME") || {
        log_error "Project '$PROJECT_NAME' not found for owner '$owner'"
        return 1
    }
    item_id=$(provider_projects_item_id_for_issue "$project_id" "$issue_num" "$owner" "$repo") || {
        log_error "Issue #$issue_num ($owner/$repo) is not (uniquely) in project '$PROJECT_NAME'"
        return 1
    }

    local field_value field_name field_val field_id option_id
    for field_value in "${FIELD_VALUES[@]}"; do
        field_name="${field_value%%=*}"
        field_val="${field_value#*=}"

        if [ "$field_name" = "$field_value" ] || [ -z "$field_name" ] || [ -z "$field_val" ]; then
            log_error "Invalid field format: $field_value (expected NAME=VALUE)"
            return 1
        fi

        read -r field_id option_id <<< "$(provider_projects_field_option_ids "$project_id" "$field_name" "$field_val")"
        if [ -z "$field_id" ] || [ -z "$option_id" ]; then
            log_error "Field '$field_name' option '$field_val' not found in project '$PROJECT_NAME' (single-select fields only)"
            return 1
        fi

        provider_projects_field_set "$project_id" "$item_id" "$field_id" "$option_id" || {
            log_error "Failed to set $field_name='$field_val' for issue #$issue_num in '$PROJECT_NAME'"
            return 1
        }
        log_info "Set $field_name='$field_val' for issue #$issue_num in project '$PROJECT_NAME'"
    done
    return 0
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
                # shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
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
                if validate_positive_integer "$1"; then
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
