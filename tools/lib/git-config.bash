#!/usr/bin/env bash
# Shared Git configuration functions
# This library provides common git configuration utilities used across devenv scripts

# Configure git settings for a local repository
# Args:
#   $1 - Repository directory path (optional, defaults to current directory)
#   $2 - Remote URL (optional, if provided will update origin with embedded credentials)
configure_git_repo() {
    local repo_dir="${1:-.}"
    local remote_url="${2:-}"
    local current_dir
    current_dir="$(pwd)"
    
    # Change to repo directory if specified
    if [ "$repo_dir" != "." ]; then
        cd "$repo_dir" || return 1
    fi
    
    local abs_dir
    abs_dir="$(pwd)"
    
    # Check if the directory is already in the safe.directory list
    if ! git config --global --get-all safe.directory | grep -Fxq "$abs_dir"; then
        git config --global --add safe.directory "$abs_dir"
    fi
    
    # Configure local repository settings
    git config core.autocrlf false
    git config core.eol lf
    git config pull.ff only
    
    # Update remote URL if provided (with embedded credentials)
    if [ -n "$remote_url" ]; then
        git remote set-url origin "$remote_url"
    fi
    
    # Return to original directory
    cd "$current_dir" || return 1
}

# Configure global git settings
# This should be run once during environment setup
configure_git_global() {
    local user_name="${1:-}"
    local user_email="${2:-}"
    
    # Core settings
    git config --global core.autocrlf false
    git config --global core.eol lf
    git config --global core.editor "code --wait"
    git config --global pull.ff only
    git config --global --bool push.autoSetupRemote true
    
    # Merge and diff tools
    git config --global merge.tool vscode
    git config --global mergetool.vscode.cmd "code --wait \$MERGED"
    git config --global diff.tool vscode
    git config --global difftool.vscode.cmd "code --wait --diff \$LOCAL \$REMOTE"
    
    # Credential management
    git config --global credential.helper store
    git config --global credential.helper 'cache --timeout=999999999'
    
    # User identity (if provided)
    if [ -n "$user_name" ]; then
        git config --global user.name "$user_name"
    fi
    if [ -n "$user_email" ]; then
        git config --global user.email "$user_email"
    fi
}

# Add a directory to git's safe.directory list
# Args:
#   $1 - Directory path to add
add_git_safe_directory() {
    local dir_path="${1:-.}"
    local abs_path
    abs_path="$(cd "$dir_path" && pwd)"
    
    if ! git config --global --get-all safe.directory | grep -Fxq "$abs_path"; then
        git config --global --add safe.directory "$abs_path"
    fi
}

# Check if we're in the devenv repo and validate permissions
# Uses the global variable ALLOW_DEVENV_REPO (should be set by calling script)
# Detects devenv repo by presence of .devcontainer/bootstrap.sh
# Args: none (uses $ALLOW_DEVENV_REPO global)
check_target_repo() {
    local git_root
    git_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
        log_error "Not in a git repository"
        exit 1
    }
    
    # Check if we're in the devenv repo by looking for the bootstrap script
    if [ -f "$git_root/.devcontainer/bootstrap.sh" ]; then
        if [ "${ALLOW_DEVENV_REPO:-0}" -eq 0 ]; then
            log_error "The current repository appears to be the devenv repository itself"
            log_info "Operations should be performed in target project repositories, not in devenv"
            log_info "To override this safety check, pass the --devenv flag"
            exit 1
        else
            log_warn "Performing operation in devenv repository (safety override enabled)"
        fi
    fi
}
