#!/bin/bash

################################################################################
# repo-update-config.sh
#
# Apply or update configuration (rulesets) to an existing cloned repository
#
# Usage:
#   ./repo-update-config.sh <repo-path> [--type <type>]
#
# Arguments:
#   repo-path - Path to the cloned repository
#
# Options:
#   --type <type>  - Repository type (optional; will be detected from GitHub if not provided)
#
# Description:
#   This script takes a path to an existing cloned repository and applies
#   configuration settings (particularly GitHub rulesets) based on the repository
#   type. If the type is not specified, it will be detected from the repository's
#   GitHub settings.
#
# Environment Variables:
#   GH_ORG - GitHub organization (required)
#
# Dependencies:
#   - git
#   - gh (GitHub CLI)
#   - yq (YAML processor)
#   - repo-types.bash
#   - github-helpers.bash
#   - error-handling.bash
#   - validation.bash
#
################################################################################

set -euo pipefail

# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/error-handling.bash"
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/validation.bash"
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/repo-types.bash"
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/github-helpers.bash"

REPO_TYPES_CONFIG="$(repo_types_config_path)"

# Verify dependencies
require_command "gh" "GitHub CLI (gh) is required. Install with: sudo apt install gh or bootstrap"
require_command "yq" "yq is required but not installed. Install with: sudo apt install yq or bootstrap"

usage() {
    echo "Usage: $(basename "$0") <repo-path> [--type <type>]" >&2
    echo "" >&2
    echo "Arguments:" >&2
    echo "  repo-path                Path to the cloned repository" >&2
    echo "" >&2
    echo "Options:" >&2
    echo "  --type <type>            Repository type (optional; auto-detected if not provided)" >&2
    echo "" >&2
    echo "Examples:" >&2
    echo "  $(basename "$0") ~/repos/my-service" >&2
    echo "  $(basename "$0") ~/repos/my-docs --type documentation" >&2
    exit 1
}

main() {
    local repo_path=""
    local repo_type=""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --type)
                shift
                if [[ $# -eq 0 ]]; then
                    log_error "--type requires an argument"
                    usage
                fi
                repo_type="$1"
                shift
                ;;
            -h|--help)
                usage
                ;;
            -*)
                log_error "Unknown option: $1"
                usage
                ;;
            *)
                if [ -z "$repo_path" ]; then
                    repo_path="$1"
                    shift
                else
                    log_error "Too many positional arguments"
                    usage
                fi
                ;;
        esac
    done

    # Validate repo path was provided
    if [ -z "$repo_path" ]; then
        log_error "Repository path is required"
        usage
    fi

    # Validate repo path exists
    if ! validate_directory_exists "$repo_path" "Repository path"; then
        return 1
    fi

    # Validate config file exists
    if ! validate_file_exists "$REPO_TYPES_CONFIG" "Repo types config"; then
        return 1
    fi

    # Get the full repository name from git remote
    log_info "Reading repository information..."
    local full_name
    if ! full_name=$(get_full_repo_name "$repo_path"); then
        return 1
    fi
    log_info "Repository: $full_name"

    # Detect repo type if not specified
    if [ -z "$repo_type" ]; then
        log_info "Detecting repository type..."
        repo_type=$(detect_repo_type "$full_name" "$REPO_TYPES_CONFIG")
    fi

    log_info "Repository type: $repo_type"

    # Validate the repo type
    if ! validate_repo_type "$full_name" "$repo_type" "$REPO_TYPES_CONFIG"; then
        return 1
    fi

    # Apply rulesets
    log_info "Applying configuration for type '$repo_type'..."
    if configure_rulesets_for_type "$full_name" "$repo_type" "$REPO_TYPES_CONFIG"; then        
        log_info "✓ Protection applied successfully"
    else
        log_error "Failed to apply protection"
    fi

    # Configure template setting
    configure_template_setting_for_type "$full_name" "$repo_type" "$REPO_TYPES_CONFIG"
    
    # Configure merge types
    configure_merge_types_for_type "$full_name" "$repo_type" "$REPO_TYPES_CONFIG"
    
    # Configure PR branch deletion on merge
    configure_pr_branch_deletion_for_type "$full_name" "$repo_type" "$REPO_TYPES_CONFIG"
    
    # Configure repository features (wiki, issues, discussions, projects, etc.)
    configure_repository_features_for_type "$full_name" "$repo_type" "$REPO_TYPES_CONFIG"
    
    # Configure repository permissions (team and user access)
    configure_repository_permissions_for_type "$full_name" "$repo_type" "$REPO_TYPES_CONFIG"
    
    log_info "✓ Configuration applied"
}

# Ensure GH_ORG is set
require_env "GH_ORG" "GH_ORG environment variable is not set. Run 'setup' first."

main "$@"
