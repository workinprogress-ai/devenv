#!/bin/bash
# repo-operations.bash - Repository discovery and management helpers
# Version: 1.0.0
# Description: Common operations for discovering, listing, and filtering repositories
# Requirements: Bash 4.0+, gh CLI
# Author: WorkInProgress.ai
# Last Modified: 2026-01-04

# Prevent multiple sourcing
if [ -n "${_REPO_OPERATIONS_LOADED:-}" ]; then
    return 0
fi
readonly _REPO_OPERATIONS_LOADED=1

# ============================================================================
# Repository Discovery and Listing
# ============================================================================

# List all repositories in a GitHub organization
#
# Fetches a list of repository names from the specified GitHub organization.
# Requires gh CLI to be installed and authenticated.
#
# Usage:
#   list_organization_repositories "myorg" 1000
#   repos=$(list_organization_repositories "myorg")
#
# Arguments:
#   $1 - Organization name (required)
#   $2 - Limit number of repos to fetch (optional, default: 1000)
#
# Returns:
#   0 on success, exits with 1 on failure
#   Outputs repository names (one per line)
#
# Examples:
#   org_repos=$(list_organization_repositories "myorg")
#   org_repos=$(list_organization_repositories "myorg" 500)
#
list_organization_repositories() {
    local org="${1:-}"
    local limit="${2:-1000}"
    
    if [ -z "$org" ]; then
        echo "ERROR: Organization name is required" >&2
        return 1
    fi
    
    if ! command -v gh &> /dev/null; then
        echo "ERROR: GitHub CLI (gh) is not installed" >&2
        return 1
    fi
    
    gh repo list "$org" --limit "$limit" --json name --jq '.[].name' 2>/dev/null || {
        echo "ERROR: Failed to list repositories in organization '$org'" >&2
        return 1
    }
}

# List all locally cloned repositories in a directory
#
# Scans the specified directory for subdirectories representing cloned repositories.
# Only lists direct subdirectories (one level deep).
#
# Usage:
#   list_local_repositories "/path/to/repos"
#   local_repos=$(list_local_repositories "$REPOS_DIR")
#
# Arguments:
#   $1 - Base directory path (required)
#
# Returns:
#   0 on success (even if directory doesn't exist or is empty)
#   Outputs repository names (one per line)
#
# Examples:
#   local_repos=$(list_local_repositories "$HOME/repos")
#   local_repos=$(list_local_repositories "/workspaces/devenv/repos")
#
list_local_repositories() {
    local base_dir="${1:-}"
    
    if [ -z "$base_dir" ]; then
        echo "ERROR: Base directory is required" >&2
        return 1
    fi
    
    if [ ! -d "$base_dir" ]; then
        # Directory doesn't exist yet, return empty list (not an error)
        return 0
    fi
    
    find "$base_dir" -mindepth 1 -maxdepth 1 -type d -exec basename {} \;
}

# ============================================================================
# Repository Filtering
# ============================================================================

# Filter out already-cloned repositories from organization repos
#
# Compares the list of organization repositories with locally cloned repositories
# and returns only those that are not yet cloned. Uses sorted comparison for
# accurate filtering.
#
# Usage:
#   available=$(filter_available_repositories "$org_repos" "$local_repos")
#   available=$(filter_available_repositories "$org_repos" "$local_repos" "$repos_dir")
#
# Arguments:
#   $1 - Organization repositories (newline-separated, required)
#   $2 - Local repositories (newline-separated, required)
#   $3 - Base directory (optional, used for validation)
#
# Returns:
#   0 on success
#   Outputs repository names not yet cloned (one per line, sorted)
#
# Examples:
#   org_repos=$(list_organization_repositories "myorg")
#   local_repos=$(list_local_repositories "$REPOS_DIR")
#   available=$(filter_available_repositories "$org_repos" "$local_repos")
#
filter_available_repositories() {
    local org_repos="${1:-}"
    local local_repos="${2:-}"
    
    if [ -z "$org_repos" ]; then
        echo "ERROR: Organization repositories list is required" >&2
        return 1
    fi
    
    # If no local repos, all org repos are available
    if [ -z "$local_repos" ]; then
        echo "$org_repos"
        return 0
    fi
    
    # Use comm to find repos in org but not locally
    comm -23 <(echo "$org_repos" | sort) <(echo "$local_repos" | sort)
}

# ============================================================================
# Repository Validation
# ============================================================================

# Validate repository name format
#
# Checks if a repository name follows valid naming conventions:
# - Starts with alphanumeric character
# - Contains only alphanumeric characters, hyphens, and dots
# - Does not match reserved names (repos, ., ..)
#
# Usage:
#   if validate_repository_name "my-repo"; then
#       echo "Valid repository name"
#   fi
#
# Arguments:
#   $1 - Repository name to validate (required)
#
# Returns:
#   0 if valid, 1 if invalid
#   Outputs error message to stderr on invalid names
#
# Examples:
#   validate_repository_name "my-awesome-repo"        # Valid
#   validate_repository_name "my-repo-123"           # Valid
#   validate_repository_name "my.repo.name"          # Valid
#   validate_repository_name "-invalid"              # Invalid (starts with -)
#   validate_repository_name "repos"                 # Invalid (reserved)
#
validate_repository_name() {
    local name="${1:-}"
    
    if [ -z "$name" ]; then
        echo "ERROR: Repository name is required" >&2
        return 1
    fi
    
    # Check for reserved names
    case "$name" in
        repos|.|..)
            echo "ERROR: Invalid repository name (reserved): $name" >&2
            return 1
            ;;
    esac
    
    # Check format: must start with alphanumeric, contain only alphanumeric, hyphens, dots
    if ! [[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]; then
        echo "ERROR: Invalid repository name format: $name" >&2
        echo "Repository names must start with alphanumeric and contain only alphanumeric, hyphens, and dots" >&2
        return 1
    fi
    
    return 0
}

# Check if a repository exists locally
#
# Verifies that a repository directory exists and is accessible.
#
# Usage:
#   if repository_exists_locally "myrepo" "$REPOS_DIR"; then
#       echo "Repository is cloned"
#   fi
#
# Arguments:
#   $1 - Repository name (required)
#   $2 - Base repositories directory (required)
#
# Returns:
#   0 if repository exists, 1 if not
#
# Examples:
#   if repository_exists_locally "devops" "$HOME/repos"; then
#       echo "devops repo is already cloned"
#   fi
#
repository_exists_locally() {
    local repo_name="${1:-}"
    local base_dir="${2:-}"
    
    if [ -z "$repo_name" ] || [ -z "$base_dir" ]; then
        echo "ERROR: Repository name and base directory are required" >&2
        return 1
    fi
    
    [ -d "$base_dir/$repo_name" ]
}

# Find a repository by name with optional fuzzy matching
#
# Searches for a repository in the local repository directory.
# Returns the full path to the matching repository.
#
# Usage:
#   repo_path=$(find_repository_by_name "devops" "$REPOS_DIR")
#   repo_path=$(find_repository_by_name "my*repo" "$REPOS_DIR")
#
# Arguments:
#   $1 - Repository name or pattern (required)
#   $2 - Base repositories directory (required)
#
# Returns:
#   0 if found, 1 if not found
#   Outputs full path to repository
#
# Examples:
#   repo_path=$(find_repository_by_name "devops" "$HOME/repos")
#   if [ -n "$repo_path" ]; then
#       echo "Found at: $repo_path"
#   fi
#
find_repository_by_name() {
    local repo_name="${1:-}"
    local base_dir="${2:-}"
    
    if [ -z "$repo_name" ] || [ -z "$base_dir" ]; then
        echo "ERROR: Repository name and base directory are required" >&2
        return 1
    fi
    
    if [ ! -d "$base_dir" ]; then
        echo "ERROR: Base directory does not exist: $base_dir" >&2
        return 1
    fi
    
    # Look for exact match first
    if [ -d "$base_dir/$repo_name" ]; then
        echo "$base_dir/$repo_name"
        return 0
    fi
    
    # Try fuzzy matching with find (shell glob)
    local matches
    matches=$(find "$base_dir" -maxdepth 1 -type d -name "*$repo_name*" 2>/dev/null)
    
    if [ -z "$matches" ]; then
        return 1
    fi
    
    # If exactly one match, return it
    local count
    count=$(echo "$matches" | wc -l)
    
    if [ "$count" -eq 1 ]; then
        echo "$matches"
        return 0
    fi
    
    # Multiple matches - return first and warn
    echo "$matches" | head -1
    echo "WARNING: Multiple matches found for '$repo_name', using first match" >&2
    return 0
}

# ============================================================================
# Repository Information
# ============================================================================

# Get the name of the current repository from git context
#
# Extracts the repository name from the current git repository's toplevel directory.
# Returns just the directory name, not the full path.
#
# Usage:
#   repo_name=$(get_current_repository_name)
#   echo "Working in: $repo_name"
#
# Returns:
#   0 if in a git repository, 1 if not
#   Outputs repository name (directory name only)
#
# Examples:
#   repo_name=$(get_current_repository_name)
#   if [ -z "$repo_name" ]; then
#       echo "Not in a git repository"
#   fi
#
get_current_repository_name() {
    local git_dir
    git_dir=$(git rev-parse --show-toplevel 2>/dev/null) || {
        echo "ERROR: Not in a git repository" >&2
        return 1
    }
    
    basename "$git_dir"
}

# Check if current directory is the devenv repository
#
# Determines if the current working directory is within the devenv repository.
# Useful for scripts that need to behave differently when in devenv vs. a cloned repo.
#
# Usage:
#   if is_devenv_repository; then
#       echo "In devenv repo"
#   fi
#
# Returns:
#   0 if in devenv repository, 1 if not
#
# Examples:
#   if is_devenv_repository; then
#       echo "Cannot run this in devenv"
#       exit 1
#   fi
#
is_devenv_repository() {
    local repo_name
    repo_name=$(get_current_repository_name 2>/dev/null) || return 1
    [ "$repo_name" = "devenv" ]
}

# ============================================================================
# Repository Directory Management
# ============================================================================

# Get or create the repositories base directory
#
# Returns the path to the repositories directory, creating it if necessary.
# Uses DEVENV_ROOT environment variable as a reference point.
#
# Usage:
#   repos_dir=$(get_or_create_repos_directory)
#   cd "$repos_dir"
#
# Returns:
#   0 on success
#   Outputs the repositories directory path
#
# Examples:
#   repos_dir=$(get_or_create_repos_directory)
#   if [ ! -w "$repos_dir" ]; then
#       echo "Cannot write to repos directory"
#   fi
#
get_or_create_repos_directory() {
    local repos_dir="${DEVENV_ROOT:-$HOME}/repos"
    
    if [ ! -d "$repos_dir" ]; then
        mkdir -p "$repos_dir" || {
            echo "ERROR: Failed to create repositories directory: $repos_dir" >&2
            return 1
        }
    fi
    
    if [ ! -w "$repos_dir" ]; then
        echo "ERROR: Repositories directory is not writable: $repos_dir" >&2
        return 1
    fi
    
    echo "$repos_dir"
}
