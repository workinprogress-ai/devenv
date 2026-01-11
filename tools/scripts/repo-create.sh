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
#   --type <type>           - Repository type (planning|documentation|template|service|gateway|app-web|cs-library|ts-package|none)
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
source "$DEVENV_TOOLS/lib/repo-types.bash"
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/github-helpers.bash"
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/git-operations.bash"
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/fzf-selection.bash"
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/error-handling.bash"
# shellcheck disable=SC1091
source "$DEVENV_TOOLS/lib/validation.bash"

REPO_TYPES_CONFIG="$(repo_types_config_path)"

# Verify yq is available for YAML processing
if ! command -v yq >/dev/null 2>&1; then
    log_error "yq is required but not installed. Install with: sudo apt install yq or bootstrap"
    exit 1
fi

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

create_initial_branch() {
    local full_name="$1"
    local repo_name="$2"
    local repo_type="$3"
    local repos_dir="$4"
    
    # Read main branch name from config
    local main_branch
    main_branch=$(yq eval -r ".types.${repo_type}.mainBranch // \"master\"" "$REPO_TYPES_CONFIG" 2>/dev/null || echo "master")
    
    local repo_path="${repos_dir}/${repo_name}"
    cd "$repo_path"
    
    # Fetch latest from origin to ensure we have all refs and objects
    git fetch origin 2>/dev/null || true
    
    # Check if the remote branch has commits
    if git rev-parse "origin/$main_branch" >/dev/null 2>&1; then
        # Remote branch exists with commits - use it
        log_info "Repository already has commits on origin, syncing..."
        
        # Ensure we're on the main branch
        git checkout -B "$main_branch" 2>/dev/null || true
        
        # Reset to origin state to ensure local matches remote exactly
        git reset --hard "origin/$main_branch"
        log_info "✓ Local branch synced with origin/$main_branch"
        
        # Set up tracking with origin
        git branch --set-upstream-to="origin/$main_branch" "$main_branch" 2>/dev/null || true
        log_info "✓ Branch tracking configured for $main_branch"
    else
        # Remote branch doesn't exist - create initial commit locally
        log_info "Setting up ${main_branch} branch with initial commit..."
        
        # Ensure we're on the main branch
        git checkout -B "$main_branch" 2>/dev/null || true
        
        # Create an empty initial commit to establish the branch
        git commit --allow-empty -m "chore: initial commit" 2>/dev/null || true
        git push -u origin "$main_branch"
        log_info "✓ ${main_branch} branch initialized and pushed"
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
    if ! validate_file_exists "$full_script_path" "Post-creation script" 2>/dev/null; then
        log_info "Post-creation script not found: $script_path (skipping)"
        return 0
    fi
    
    log_info "Running post-creation script: $script_path"
    
    # Make script executable and run it
    chmod +x "$full_script_path"
    if ! (cd "$repo_dir" && "$full_script_path"); then
        log_warn "Post-creation script failed"
        return 1
    fi
    
    log_info "✓ Post-creation script completed"
    
    # Delete script if configured
    if [ "$delete_script" = "true" ]; then
        rm -f "$full_script_path"
        log_info "✓ Post-creation script deleted"
    fi
    
    # Handle commits based on configuration
    cd "$repo_dir"
    
    # Check if there are any changes
    if git diff-index --quiet HEAD -- 2>/dev/null; then
        log_info "No changes to commit"
        return 0
    fi
    
    case "$commit_handling" in
        amend)
            # Check if there's a commit to amend
            if git rev-parse HEAD >/dev/null 2>&1; then
                log_info "Amending initial commit with post-creation changes..."
                git add -A
                git commit --amend --no-edit -n
                git push --force-with-lease
                log_info "✓ Initial commit amended and force pushed"
            else
                # No commit to amend, create new commit instead
                log_info "No existing commit to amend, creating new commit..."
                git add -A
                git commit -m "chore: post-creation setup for ${repo_name}"
                git push
                log_info "✓ New commit created and pushed"
            fi
            ;;
        new)
            log_info "Creating new commit for post-creation changes..."
            git add -A
            git commit -m "chore: post-creation setup for ${repo_name}"
            git push
            log_info "✓ New commit created and pushed"
            ;;
        none)
            log_info "Post-creation changes detected but commit_handling is 'none'"
            log_info "You will need to commit these changes manually"
            ;;
        *)
            log_warn "Unknown commit_handling value: $commit_handling"
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
        log_info "Repository '$full_name' already exists. Nothing to do."
        return 0
    fi

    # Validate naming convention for repo type
    if ! validate_repo_type "$repo_name" "$repo_type" "$REPO_TYPES_CONFIG"; then
        exit 1
    fi

    log_info "Creating repository '$full_name' (type: $repo_type)..."
    
    # Get template if applicable
    local template=""
    if [ "$skip_template" != "true" ]; then
        template=$(yq eval ".types.${repo_type}.template" "$REPO_TYPES_CONFIG")
    fi
    
    local args=("repo" "create" "$full_name" "--${visibility}" "--disable-wiki")
    
    if [ -n "$description" ]; then
        args+=("--description" "$description")
    fi
    
    # Add template if available and not skipped
    if [ -n "$template" ] && [ "$template" != "null" ]; then
        args+=("--template" "${GH_ORG}/${template}")
        log_info "Using template: ${GH_ORG}/${template}"
    fi

    if ! gh "${args[@]}"; then
        log_error "Failed to create repository"
        exit 1
    fi
    
    log_info "✓ Repository created: git@github.com:${full_name}.git"
    
    # Mark repository as template if configured
    local is_template
    is_template=$(yq eval ".types.${repo_type}.isTemplate // false" "$REPO_TYPES_CONFIG")
    if [ "$is_template" = "true" ]; then
        log_info "Marking repository as a template..."
        if gh repo edit "$full_name" --template; then
            log_info "✓ Repository marked as template"
        else
            log_warn "Failed to mark repository as template"
        fi
    fi
    
    # Clone repo using repo-get unless skipped
    local repos_dir
    repos_dir=$(get_or_create_repos_directory)
    
    if [ "$skip_clone" != "true" ]; then
        log_info "Cloning repository locally..."
        local repo_get_script="${DEVENV_TOOLS}/scripts/repo-get.sh"
        if [ -f "$repo_get_script" ]; then
            if "$repo_get_script" "$repo_name"; then
                log_info "✓ Repository cloned to ${repos_dir}/$repo_name"
                
                # Create initial branch to enable branch protection
                create_initial_branch "$full_name" "$repo_name" "$repo_type" "$repos_dir"
                
                # Configure rulesets after branch exists
                if [ "$skip_protection" != "true" ]; then
                    configure_rulesets_for_type "$full_name" "$repo_type" "$REPO_TYPES_CONFIG"
                fi
                
                # Run post-creation script if applicable
                if [ "$skip_post_creation" != "true" ]; then
                    run_post_creation_script "${repos_dir}/${repo_name}" "$repo_type" "$repo_name"
                fi
            else
                log_warn "Failed to clone repository"
            fi
        else
            log_warn "repo-get.sh not found, skipping clone"
        fi
    else
        # If skip_clone is true but branch protection is needed, warn user
        if [ "$skip_protection" != "true" ]; then
            log_warn "Branch protection cannot be configured without cloning the repo first"
            log_info "Clone the repo and run the following to set up branch protection:"
            log_info "cd ${repos_dir}/$repo_name && git push origin master"
        fi
    fi
    
    echo ""
    log_info "Repository creation complete!\""
    log_info ""
    log_info "Next steps:"
    if [ "$skip_clone" = "true" ]; then
        log_info "  1. Clone the repo: git clone git@github.com:${full_name}.git"
        log_info "  2. Make your changes and commit"
    else
        log_info "  1. Navigate to repo: cd ${repos_dir}/$repo_name"
        log_info "  2. Make your changes and commit"
    fi
}

select_repo_type_interactive() {
    require_command fzf
    
    local types
    types=$(yq eval '.types | keys[]' "$REPO_TYPES_CONFIG")
    
    local type_list=""
    while IFS= read -r type; do
        local desc
        local example
        desc=$(yq eval ".types.${type}.description" "$REPO_TYPES_CONFIG")
        example=$(yq eval ".types.${type}.naming_example" "$REPO_TYPES_CONFIG")
        local line
        line=$(printf '%s\t%s\tExample: %s' "$type" "$desc" "$example")
        type_list="${type_list}${line}"$'\n'
    done <<< "$types"
    
    local selected
    local fzf_result
    fzf_result=$(fzf_select_single "$type_list" "Select repository type: ")
    selected=$(fzf_extract_field "$fzf_result" 1 $'\t')
    
    if [ -z "$selected" ]; then
        log_error "No type selected"
        exit 1
    fi
    
    echo "$selected"
}

prompt_for_repo_name() {
    local repo_type="$1"
    local example
    example=$(yq eval ".types.${repo_type}.naming_example" "$REPO_TYPES_CONFIG")
    
    log_info "Enter repository name (example: $example)"
    
    # Use a dedicated file descriptor to ensure clean stdin after fzf
    read -r -p "Repository name: " repo_name < /dev/tty
    
    validate_not_empty "$repo_name" "Repository name" || exit 1
    
    echo "$repo_name"
}

prompt_for_description() {
    log_info "Enter repository description (optional, press Enter to skip)"
    
    read -r -p "Description: " description < /dev/tty
    
    echo "$description"
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
                # Support repo name after options (e.g., --type documentation my-repo)
                if [ -z "$repo_name" ] && [ "${1:0:1}" != "-" ]; then
                    repo_name="$1"
                else
                    log_error "Unknown option '$1'"
                    usage
                    exit 1
                fi
                ;;
        esac
        shift || true
    done

    REPO_TYPES_CONFIG=$(load_repo_types_config "$REPO_TYPES_CONFIG") || exit 1
    
    # Interactive mode: prompt for type and name
    if [ "$interactive_mode" = "true" ]; then
        repo_type=$(select_repo_type_interactive)
        repo_name=$(prompt_for_repo_name "$repo_type")
        description=$(prompt_for_description)
    fi
    
    # Validate required arguments
    if ! validate_not_empty "$repo_name" "Repository name"; then
        usage
        exit 1
    fi
    
    if ! validate_not_empty "$repo_type" "Repository type"; then
        log_info "Use --type flag or --interactive mode"
        usage
        exit 1
    fi

    require_command gh
    require_command yq
    require_env GH_ORG "GH_ORG is not set. Run 'setup' first to configure environment."
    require_env GH_USER "GH_USER is not set. Run 'setup' first to configure environment."
    ensure_gh_login
    
    create_repo "$repo_name" "$visibility" "$description" "$repo_type" "$skip_protection" "$skip_template" "$skip_clone" "$skip_post_creation"
}

main "$@"
