#!/bin/bash

################################################################################
# repo-create.sh
#
# Create a new GitHub repository with standardized configuration
#
# Usage:
#   ./repo-create.sh <repo-name> --type <type> [OPTIONS]
#   ./repo-create.sh --interactive                        # Interactive mode
#
# Arguments:
#   repo-name - Name of the repository to create
#
# Options:
#   --type <type>           - Repository type (planning|service|gateway|app-web|cs-library|ts-package|none)
#   --interactive, -i       - Interactive mode (select type and enter name)
#   --public|--private      - Repository visibility (default: private)
#   --description <text>    - Repository description
#   --no-branch-protection  - Skip branch protection setup
#   --no-template           - Skip using template repo (if one exists for this type)
#   --no-clone              - Skip cloning repo after creation
#   --no-post-creation      - Skip running post-creation script
#
# Template Repos:
#   Each repository type has an optional template repo that will be used as a base.
#   Use --no-template to skip template initialization.
#
# Post-Creation Scripts:
#   Repository templates can include a post-creation script (typically .repo/post-create.sh).
#   This script runs after the repo is cloned locally to customize the new repository.
#   The script is optionally deleted after execution based on repo type configuration.
#
# Environment Variables:
#   GH_ORG - GitHub organization for repository creation
#
# Dependencies:
#   - git
#   - gh (GitHub CLI)
#   - yq (YAML processor)
#   - repo-operations.bash
#   - github-helpers.bash
#   - git-operations.bash
#   - fzf-selection.bash
#
################################################################################

set -euo pipefail

# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/repo-operations.bash"
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/github-helpers.bash"
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/git-operations.bash"
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/fzf-selection.bash"
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/error-handling.bash"

# Verify yq is available for YAML processing
if ! command -v yq >/dev/null 2>&1; then
    echo "ERROR: yq is required but not installed. Install with: sudo apt install yq or bootstrap" >&2
    exit 1
fi

REPO_TYPES_CONFIG="${DEVENV_TOOLS}/config/repo-types.yaml"

usage() {
    echo "Usage: $(basename "$0") <repo-name> --type <type> [OPTIONS]" >&2
    echo "       $(basename "$0") --interactive" >&2
    echo "" >&2
    echo "Options:" >&2
    echo "  --type <type>           Repository type (see below)" >&2
    echo "  --interactive, -i       Interactive mode (select type and enter name)" >&2
    echo "  --public|--private      Visibility (default: private)" >&2
    echo "  --description <text>    Repository description" >&2
    echo "  --no-branch-protection  Skip branch protection setup" >&2
    echo "  --no-template           Skip template initialization" >&2
    echo "  --no-clone              Skip cloning repo after creation" >&2
    echo "  --no-post-creation      Skip running post-creation script" >&2
    echo "" >&2
    echo "Repository Types:" >&2
    if [ -f "$REPO_TYPES_CONFIG" ]; then
        yq eval '.types | keys[] as $k | "  \($k): " + .[$k].naming_example + " (template: " + (.[$k].template // "none") + ")"' "$REPO_TYPES_CONFIG" 2>/dev/null || echo "  (unable to read repo types)" || true
    fi
    echo "" >&2
}

require_cmd() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "ERROR: '$cmd' is required but not installed." >&2
        exit 1
    fi
}

validate_repo_type() {
    local repo_name="$1"
    local repo_type="$2"
    
    if [ "$repo_type" = "none" ]; then
        return 0
    fi
    
    if [ ! -f "$REPO_TYPES_CONFIG" ]; then
        echo "ERROR: Repo types config not found at $REPO_TYPES_CONFIG" >&2
        return 1
    fi
    
    local pattern
    pattern=$(yq eval ".types.${repo_type}.naming_pattern // empty" "$REPO_TYPES_CONFIG")
    
    if [ -z "$pattern" ]; then
        echo "ERROR: Unknown repository type '$repo_type'" >&2
        echo "Valid types:" >&2
        yq eval '.types | keys[]' "$REPO_TYPES_CONFIG" | sed 's/^/  /' >&2
        return 1
    fi
    
    if ! echo "$repo_name" | grep -qE "$pattern"; then
        local example
        example=$(yq eval ".types.${repo_type}.naming_example" "$REPO_TYPES_CONFIG")
        echo "ERROR: Repository name '$repo_name' does not match pattern for type '$repo_type'" >&2
        echo "Expected pattern: $example" >&2
        return 1
    fi
    
    return 0
}

configure_branch_protection_for_type() {
    local full_name="$1"
    local repo_type="$2"
    
    if [ ! -f "$REPO_TYPES_CONFIG" ]; then
        echo "WARNING: Repo types config not found, skipping branch protection" >&2
        return 0
    fi
    
    echo "Configuring branch protection for master..."
    
    # Read protection settings from config using yq
    local require_pr
    local review_count
    local require_owners
    local dismiss_stale
    local require_conversation
    local delete_branch
    local allow_force
    local required_status_checks
    
    require_pr=$(yq eval ".types.${repo_type}.branch_protection.require_pull_request" "$REPO_TYPES_CONFIG")
    review_count=$(yq eval ".types.${repo_type}.branch_protection.required_approving_review_count" "$REPO_TYPES_CONFIG")
    require_owners=$(yq eval ".types.${repo_type}.branch_protection.require_code_owner_reviews" "$REPO_TYPES_CONFIG")
    dismiss_stale=$(yq eval ".types.${repo_type}.branch_protection.dismiss_stale_reviews" "$REPO_TYPES_CONFIG")
    require_conversation=$(yq eval ".types.${repo_type}.branch_protection.require_conversation_resolution" "$REPO_TYPES_CONFIG")
    delete_branch=$(yq eval ".types.${repo_type}.branch_protection.delete_branch_on_merge" "$REPO_TYPES_CONFIG")
    allow_force=$(yq eval ".types.${repo_type}.branch_protection.allow_force_pushes" "$REPO_TYPES_CONFIG")
    required_status_checks=$(yq eval ".types.${repo_type}.branch_protection.required_status_checks" "$REPO_TYPES_CONFIG")
    
    # Set delete branch on merge (repo-level setting)
    if [ "$delete_branch" = "true" ]; then
        set_repo_setting "$full_name" "delete_branch_on_merge" "true"
    fi
    
    # Skip branch protection if not required
    if [ "$require_pr" != "true" ]; then
        echo "  Branch protection not required for type '$repo_type'"
        return 0
    fi
    
    # Build branch protection payload
    # Convert required_status_checks array to proper format (null if empty)
    local status_checks_payload="null"
    if [ "$required_status_checks" != "[]" ] && [ -n "$required_status_checks" ]; then
        status_checks_payload="{\"strict\": true, \"contexts\": $required_status_checks}"
    fi
    
    local protection_payload="{
        \"required_status_checks\": $status_checks_payload,
        \"enforce_admins\": false,
        \"required_pull_request_reviews\": {
            \"required_approving_review_count\": ${review_count},
            \"require_code_owner_reviews\": ${require_owners},
            \"dismiss_stale_reviews\": ${dismiss_stale}
        },
        \"restrictions\": null,
        \"allow_force_pushes\": ${allow_force},
        \"allow_deletions\": false,
        \"required_conversation_resolution\": ${require_conversation}
    }"
    
    # Apply branch protection using library function
    configure_branch_protection "$full_name" "master" "$protection_payload"
}

ensure_env() {
    if [ -z "${GH_ORG:-}" ]; then
        echo "ERROR: GH_ORG is not set. Run 'setup' first." >&2
        exit 1
    fi
    if [ -z "${GH_USER:-}" ]; then
        echo "ERROR: GH_USER is not set. Run 'setup' first." >&2
        exit 1
    fi
}

run_post_creation_script() {
    local repo_dir="$1"
    local repo_type="$2"
    local repo_name="$3"
    
    local script_path
    local delete_script
    local commit_handling
    
    script_path=$(yq eval ".types.${repo_type}.post_creation_script" "$REPO_TYPES_CONFIG")
    delete_script=$(yq eval ".types.${repo_type}.delete_post_creation_script // true" "$REPO_TYPES_CONFIG")
    commit_handling=$(yq eval ".types.${repo_type}.post_creation_commit_handling // \"none\"" "$REPO_TYPES_CONFIG")
    
    # Skip if no script configured
    if [ "$script_path" = "null" ] || [ -z "$script_path" ]; then
        return 0
    fi
    
    local full_script_path="${repo_dir}/${script_path}"
    
    # Skip if script doesn't exist
    if [ ! -f "$full_script_path" ]; then
        echo "  Post-creation script not found: $script_path (skipping)"
        return 0
    fi
    
    echo ""
    echo "Running post-creation script: $script_path"
    
    # Make script executable and run it
    chmod +x "$full_script_path"
    if ! (cd "$repo_dir" && "$full_script_path"); then
        echo "  WARNING: Post-creation script failed"
        return 1
    fi
    
    echo "  ✓ Post-creation script completed"
    
    # Delete script if configured
    if [ "$delete_script" = "true" ]; then
        rm -f "$full_script_path"
        echo "  ✓ Post-creation script deleted"
    fi
    
    # Handle commits based on configuration
    cd "$repo_dir"
    
    # Check if there are any changes
    if git diff-index --quiet HEAD -- 2>/dev/null; then
        echo "  No changes to commit"
        return 0
    fi
    
    case "$commit_handling" in
        amend)
            echo "  Amending initial commit with post-creation changes..."
            git add -A
            git commit --amend --no-edit
            git push --force-with-lease
            echo "  ✓ Initial commit amended and force pushed"
            ;;
        new)
            echo "  Creating new commit for post-creation changes..."
            git add -A
            git commit -m "chore: post-creation setup for ${repo_name}"
            git push
            echo "  ✓ New commit created and pushed"
            ;;
        none)
            echo "  Post-creation changes detected but commit_handling is 'none'"
            echo "  You will need to commit these changes manually"
            ;;
        *)
            echo "  WARNING: Unknown commit_handling value: $commit_handling"
            ;;
    esac
}

create_repo() {
    local repo_name="$1"
    local visibility="$2"
    local description="$3"
    local repo_type="$4"
    local skip_protection="$5"
    local skip_template="$6"
    local skip_clone="$7"
    local skip_post_creation="$8"
    local full_name="${GH_ORG}/${repo_name}"

    # Check if repo already exists
    if gh repo view "$full_name" >/dev/null 2>&1; then
        echo "Repository '$full_name' already exists. Nothing to do." >&2
        return 0
    fi

    # Validate naming convention for repo type
    if ! validate_repo_type "$repo_name" "$repo_type"; then
        exit 1
    fi

    echo "Creating repository '$full_name' (type: $repo_type)..."
    
    # Get template if applicable
    local template=""
    if [ "$skip_template" != "true" ]; then
        template=$(yq eval ".types.${repo_type}.template" "$REPO_TYPES_CONFIG")
    fi
    
    local args=("repo" "create" "$full_name" "--${visibility}" "--confirm" "--disable-wiki")
    
    if [ -n "$description" ]; then
        args+=("--description" "$description")
    fi
    
    # Add template if available and not skipped
    if [ -n "$template" ] && [ "$template" != "null" ]; then
        args+=("--template" "${GH_ORG}/${template}")
        echo "  Using template: ${GH_ORG}/${template}"
    fi

    if ! gh "${args[@]}"; then
        echo "ERROR: Failed to create repository" >&2
        exit 1
    fi
    
    echo "✓ Repository created: git@github.com:${full_name}.git"
    
    # Configure branch protection unless skipped
    if [ "$skip_protection" != "true" ]; then
        configure_branch_protection_for_type "$full_name" "$repo_type"
    fi
    
    # Clone repo using repo-get unless skipped
    if [ "$skip_clone" != "true" ]; then
        echo ""
        echo "Cloning repository locally..."
        local repo_get_script="${DEVENV_TOOLS}/scripts/repo-get.sh"
        if [ -f "$repo_get_script" ]; then
            if "$repo_get_script" "$repo_name"; then
                echo "✓ Repository cloned to $(get_or_create_repos_directory)/$repo_name"
                
                # Run post-creation script if applicable
                if [ "$skip_post_creation" != "true" ]; then
                    local repos_dir
                    repos_dir=$(get_or_create_repos_directory)
                    run_post_creation_script "${repos_dir}/${repo_name}" "$repo_type" "$repo_name"
                fi
            else
                echo "WARNING: Failed to clone repository"
            fi
        else
            echo "WARNING: repo-get.sh not found, skipping clone"
        fi
    fi
    
    echo ""
    echo "Repository creation complete!"
    echo ""
    echo "Next steps:"
    if [ "$skip_clone" = "true" ]; then
        echo "  1. Clone the repo: git clone git@github.com:${full_name}.git"
    else
        echo "  1. Navigate to repo: cd $(get_or_create_repos_directory)/$repo_name"
    fi
    echo "  2. Make your changes and commit"
    echo "  3. Branch protection will be active after master branch exists"
}

select_repo_type_interactive() {
    check_fzf_installed || {
        echo "ERROR: fzf is required for interactive mode" >&2
        exit 1
    }
    
    local types
    types=$(yq eval '.types | keys[]' "$REPO_TYPES_CONFIG")
    
    local type_list=""
    while IFS= read -r type; do
        local desc
        local example
        desc=$(yq eval ".types.${type}.description" "$REPO_TYPES_CONFIG")
        example=$(yq eval ".types.${type}.naming_example" "$REPO_TYPES_CONFIG")
        type_list="${type_list}${type} | ${desc} | Example: ${example}\n"
    done <<< "$types"
    
    local selected
    selected=$(fzf_select_single "$type_list" "Select repository type: " | awk '{print $1}')
    
    if [ -z "$selected" ]; then
        echo "ERROR: No type selected" >&2
        exit 1
    fi
    
    echo "$selected"
}

prompt_for_repo_name() {
    local repo_type="$1"
    local example
    example=$(yq eval ".types.${repo_type}.naming_example" "$REPO_TYPES_CONFIG")
    
    echo ""
    echo "Enter repository name (example: $example)"
    read -r -p "Repository name: " repo_name
    
    if [ -z "$repo_name" ]; then
        echo "ERROR: Repository name is required" >&2
        exit 1
    fi
    
    echo "$repo_name"
}

main() {
    # Check for help flag first
    if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
        usage
        exit 0
    fi
    
    # Initialize variables
    local visibility="private"
    local description=""
    local repo_type=""
    local skip_protection="false"
    local skip_template="false"
    local skip_clone="false"
    local skip_post_creation="false"
    local interactive_mode="false"
    local repo_name=""
    
    # Check for interactive mode flag
    if [ "${1:-}" = "--interactive" ] || [ "${1:-}" = "-i" ]; then
        interactive_mode="true"
        shift
    elif [ $# -ge 1 ] && [ "${1:0:1}" != "-" ]; then
        # First argument is the repo name (positional)
        repo_name="$1"
        shift
    fi

    # Parse options
    while [ $# -gt 0 ]; do
        case "$1" in
            --public)
                visibility="public"
                ;;
            --private)
                visibility="private"
                ;;
            --description)
                shift
                description="${1:-}"
                ;;
            --type)
                shift
                repo_type="${1:-}"
                ;;
            --no-branch-protection)
                skip_protection="true"
                ;;
            --no-template)
                skip_template="true"
                ;;
            --no-clone)
                skip_clone="true"
                ;;
            --no-post-creation)
                skip_post_creation="true"
                ;;
            --interactive|-i)
                interactive_mode="true"
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            *)
                echo "ERROR: Unknown option '$1'" >&2
                usage
                exit 1
                ;;
        esac
        shift || true
    done
    
    # Interactive mode: prompt for type and name
    if [ "$interactive_mode" = "true" ]; then
        repo_type=$(select_repo_type_interactive)
        repo_name=$(prompt_for_repo_name "$repo_type")
    fi
    
    # Validate required arguments
    if [ -z "$repo_name" ]; then
        echo "ERROR: Repository name is required" >&2
        echo "" >&2
        usage
        exit 1
    fi
    
    if [ -z "$repo_type" ]; then
        echo "ERROR: --type is required (or use --interactive mode)" >&2
        echo "" >&2
        usage
        exit 1
    fi

    require_cmd gh
    require_cmd yq
    ensure_env
    ensure_gh_login
    
    create_repo "$repo_name" "$visibility" "$description" "$repo_type" "$skip_protection" "$skip_template" "$skip_clone" "$skip_post_creation"
}

main "$@"
