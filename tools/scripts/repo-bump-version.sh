#!/bin/bash

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/release-operations.bash"
source "$DEVENV_TOOLS/lib/git-config.bash"

script_folder="${DEVENV_TOOLS:-.}/scripts"
repos_dir="$DEVENV_ROOT/repos"

# Function to display usage
usage() {
  cat << EOF
Usage: $0 <change-type> [repository-names...]

Forces an empty commit in multiple repositories to trigger version updates.

Arguments:
  change-type       Type of version change: 'patch', 'minor', or 'major'
  repository-names  List of repository names (can be provided via heredoc)

Examples:
  $0 patch repo1 repo2 repo3
  
  $0 minor << EOF
  service-auth0
  service-user
  service-payment
EOF

Process:
  Ensures each repo is up-to-date, switches to master, checks for custom
  commit type support in release config, creates empty commit, and pushes.

EOF
}

# Validate change type parameter
if [ -z "$1" ]; then
    log_error "Missing required argument: change-type"
    usage
    exit "$EXIT_INVALID_ARGUMENT"
fi

CHANGE_TYPE="$1"
shift

# Validate change type
if [[ ! "$CHANGE_TYPE" =~ ^(patch|minor|major)$ ]]; then
    log_error "Invalid change-type: '$CHANGE_TYPE'. Must be 'patch', 'minor', or 'major'."
    usage
    exit "$EXIT_INVALID_ARGUMENT"
fi

# Collect repository names from arguments or stdin
REPOS=()
if [ $# -gt 0 ]; then
    # Arguments provided
    REPOS=("$@")
else
    # Read from stdin (heredoc)
    while IFS= read -r line || [ -n "$line" ]; do
        # Skip empty lines and comments
        line=$(echo "$line" | sed 's/#.*//' | xargs)
        if [ -n "$line" ]; then
            REPOS+=("$line")
        fi
    done
fi

if [ ${#REPOS[@]} -eq 0 ]; then
    log_error "No repositories provided"
    usage
    exit "$EXIT_INVALID_ARGUMENT"
fi

log_info "Processing ${#REPOS[@]} repository/repositories with change type: $CHANGE_TYPE"
echo

# Track statistics
total_repos=${#REPOS[@]}
success_count=0
skip_count=0
fail_count=0
declare -a failed_repos

# Process each repository
for repo in "${REPOS[@]}"; do
    log_info "----------------------------------------"
    log_info "Processing: $repo"
    
    repo_path="$repos_dir/$repo"
    
    # Step 1: Ensure repo is up to date using repo-get.sh
    log_info "Ensuring repository is up to date..."
    if ! "$script_folder/repo-get.sh" "$repo"; then
        log_error "Failed to update repository: $repo"
        failed_repos+=("$repo (update failed)")
        ((fail_count++))
        continue
    fi
    
    # Change to repo directory
    if ! cd "$repo_path"; then
        log_error "Failed to change directory to: $repo_path"
        failed_repos+=("$repo (cd failed)")
        ((fail_count++))
        continue
    fi
    
    # Step 2: Ensure we're on master branch
    current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [ "$current_branch" != "master" ]; then
        log_info "Switching from '$current_branch' to 'master' branch..."
        if ! git checkout master; then
            log_error "Failed to checkout master branch"
            failed_repos+=("$repo (checkout failed)")
            ((fail_count++))
            cd - &>/dev/null || return
            continue
        fi
    fi
    
    # Step 3: Check if repo supports custom commit types
    supports_custom="false"
    if check_release_config_supports_custom_types "$repo_path"; then
        supports_custom="true"
        log_info "Repository supports custom commit types (patch/minor/major)"
    else
        log_warn "Repository does not support custom commit types, falling back to conventional commits"
    fi
    
    # Step 4: Determine commit type using library function
    commit_type=$(get_conventional_commit_type "$CHANGE_TYPE" "$supports_custom")
    commit_message="${commit_type}: force version update"
    
    log_info "Using commit message: '$commit_message'"
    
    # Step 5: Create empty commit
    if ! git commit --allow-empty -m "$commit_message" -n; then
        log_error "Failed to create empty commit"
        failed_repos+=("$repo (commit failed)")
        ((fail_count++))
        cd - &>/dev/null || return
        continue
    fi
    
    # Step 6: Push to origin
    log_info "Pushing to origin/master..."
    if ! git push origin master; then
        log_error "Failed to push commit to origin"
        log_warn "You may need to manually push or the commit was created locally"
        failed_repos+=("$repo (push failed)")
        ((fail_count++))
        cd - &>/dev/null || return
        continue
    fi
    
    log_info "✓ Successfully forced commit in: $repo"
    ((success_count++))
    
    cd - &>/dev/null || return
done

# Print summary
echo
log_info "========================================"
log_info "SUMMARY"
log_info "========================================"
log_info "Total repositories: $total_repos"
log_info "✓ Successful: $success_count"
if [ $skip_count -gt 0 ]; then
    log_warn "Skipped: $skip_count"
fi
if [ $fail_count -gt 0 ]; then
    log_error "Failed: $fail_count"
    if [ ${#failed_repos[@]} -gt 0 ]; then
        log_error "Failed repositories:"
        for failed in "${failed_repos[@]}"; do
            echo "  - $failed"
        done
    fi
fi
log_info "========================================"

# Exit with appropriate code
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/release-operations.bash"

if [ $fail_count -gt 0 ]; then
    exit "$EXIT_GENERAL_ERROR"
else
    exit "$EXIT_SUCCESS"
fi
