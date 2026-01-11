#!/bin/bash
# github-helpers.bash - GitHub CLI helper functions
# Version: 1.0.0
# Description: Common helper functions for GitHub CLI operations
# Requirements: Bash 4.0+, gh CLI
# Author: WorkInProgress.ai
# Last Modified: 2026-01-02

# Prevent multiple sourcing
if [ -n "${_GITHUB_HELPERS_LOADED:-}" ]; then
    return 0
fi
readonly _GITHUB_HELPERS_LOADED=1

# ============================================================================
# GitHub CLI Helpers
# ============================================================================

# Build repository specification for gh CLI commands
# 
# This function determines the appropriate repository specification for gh CLI
# commands that accept the -R flag. It tries multiple sources in order:
#   1. GITHUB_REPO environment variable (explicit override)
#   2. GH_ORG + current repository name (constructed from context)
#   3. Empty (falls back to git context)
#
# Usage:
#   local repo_spec
#   read -ra repo_spec <<< "$(get_repo_spec)"
#   gh issue list "${repo_spec[@]}" --state open
#
# Environment Variables:
#   GITHUB_REPO    - Full repository specification in format "owner/repo"
#   GITHUB_ORG     - GitHub organization or user name
#
# Returns:
#   Outputs "-R owner/repo" if repository can be determined, empty string otherwise
#
get_repo_spec() {
    # If GITHUB_REPO is set, use it
    if [ -n "${GITHUB_REPO:-}" ]; then
        echo "-R" "$GITHUB_REPO"
        return
    fi
    
    # Otherwise, try to construct from GH_ORG and current repo
    if [ -n "${GH_ORG:-}" ]; then
        local repo_name
        repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
        if [ -n "$repo_name" ]; then
            echo "-R" "${GH_ORG}/${repo_name}"
            return
        fi
    fi
    
    # Fall back to current directory context (no -R flag)
    echo ""
}

# Get GitHub repository owner (organization or user)
#
# This function determines the owner of the current repository, checking
# in order:
#   1. GH_ORG environment variable
#   2. gh repo view query (requires gh CLI access)
#
# Usage:
#   owner=$(get_repo_owner)
#
# Environment Variables:
#   GITHUB_ORG     - GitHub organization or user name
#
# Returns:
#   Outputs the owner name, exits with error if cannot be determined
#
get_repo_owner() {
    if [ -n "${GH_ORG:-}" ]; then
        echo "$GH_ORG"
    else
        local repo_spec=""
        local repo_name
        repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
        if [ -n "$repo_name" ]; then
            repo_spec="-R $repo_name"
        fi
        # shellcheck disable=SC2086
        gh repo view $repo_spec --json owner -q .owner.login
    fi
}

# Get the full repository name (owner/repo) from an arbitrary repository path
#
# This function extracts the full repository specification (owner/repo format)
# from a given repository path. It uses gh CLI when available, with a graceful
# fallback to parsing the git remote URL for robustness.
#
# Usage:
#   full_name=$(get_full_repo_name "/path/to/repo")
#   echo "$full_name"  # outputs: owner/repo
#
# Arguments:
#   $1 - Path to the repository (required)
#
# Returns:
#   0 on success, 1 on error
#   Outputs the full repository name in "owner/repo" format
#
# Examples:
#   full_name=$(get_full_repo_name "$REPOS_DIR/my-service")
#   full_name=$(get_full_repo_name "~/workspace/project")
#
# Notes:
#   - First tries gh repo view for most accurate information
#   - Falls back to parsing git remote origin URL if gh unavailable
#   - Requires git repository with remote origin configured
#
get_full_repo_name() {
    local repo_path="${1:-}"

    if [ -z "$repo_path" ]; then
        echo "ERROR: Repository path is required" >&2
        return 1
    fi

    # Change to repo directory and get the full name using gh
    if ! cd "$repo_path" 2>/dev/null; then
        echo "ERROR: Failed to change to repository path: $repo_path" >&2
        return 1
    fi

    # Use gh to get the full repo name in owner/repo format
    local full_name
    full_name=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null) || {
        # Fallback: try to parse from git remote URL
        local git_url
        git_url=$(git config --get remote.origin.url 2>/dev/null || echo "")
        
        if [ -z "$git_url" ]; then
            echo "ERROR: No git remote 'origin' found in repository" >&2
            return 1
        fi
        
        # Extract owner/repo from URL (handles both HTTPS and SSH formats)
        # HTTPS: https://github.com/owner/repo.git or https://github.com/owner/repo
        # SSH: git@github.com:owner/repo.git or git@github.com:owner/repo
        if [[ "$git_url" =~ ^git@[^:]+:([^/]+)/(.+?)(\.git)?$ ]]; then
            # SSH format: git@github.com:owner/repo.git
            local owner="${BASH_REMATCH[1]}"
            local repo="${BASH_REMATCH[2]}"
            # Strip .git suffix if present
            repo="${repo%.git}"
            full_name="${owner}/${repo}"
        else
            # HTTPS format or other: extract last two path segments
            full_name=$(echo "$git_url" | sed -E 's|.*/([^/]+)/([^/]+?)(\.git)?$|\1/\2|')
        fi
        
        if [ -z "$full_name" ] || [ "$full_name" = "$git_url" ]; then
            echo "ERROR: Could not parse repository name from git remote URL: $git_url" >&2
            return 1
        fi
    }

    echo "$full_name"
}

# Ensure GitHub CLI authentication
#
# This function checks if the user is authenticated with GitHub CLI.
# If not authenticated, it attempts to authenticate using the GH_TOKEN
# environment variable (PAT). If no token is available, it prompts
# the user to authenticate interactively with sensible defaults
# (github.com as hostname, ssh as git protocol).
#
# Usage:
#   ensure_gh_login
#
# Environment Variables:
#   GH_TOKEN       - GitHub Personal Access Token (optional)
#
# Returns:
#   0 if authenticated successfully, exits with error if authentication fails
#
ensure_gh_login() {
    # Check if already authenticated
    if gh auth status &>/dev/null; then
        return 0
    fi
    
    # Try to authenticate with GH_TOKEN if available
    if [ -n "${GH_TOKEN:-}" ]; then
        echo "$GH_TOKEN" | gh auth login --with-token --hostname github.com --skip-ssh-key 2>/dev/null && return 0
    fi
    
    # If not authenticated and no token, fail with clear error
    echo "Error: GitHub CLI is not authenticated and GH_TOKEN is not set" >&2
    echo "Please set GH_TOKEN environment variable or authenticate with: gh auth login" >&2
    exit 1
}

# Check required dependencies for GitHub CLI operations
#
# This function validates that all required tools for GitHub operations
# are installed and properly configured:
#   - gh: GitHub CLI
#   - gh authentication: Must be logged in
#   - jq: JSON query tool (for parsing GitHub API responses)
#
# Usage:
#   check_dependencies
#
# Environment Variables:
#   (none - uses defaults)
#
# Returns:
#   0 if all dependencies are met, exits with error if any are missing
#
check_dependencies() {
    if ! command -v gh &> /dev/null; then
        log_error "GitHub CLI (gh) is not installed or not in PATH"
        log_info "Install from: https://cli.github.com/"
        exit 1
    fi

    if ! gh auth status &> /dev/null; then
        log_error "Not authenticated with GitHub CLI"
        log_info "Run: gh auth login"
        exit 1
    fi
    
    if ! command -v jq &> /dev/null; then
        log_error "jq is not installed or not in PATH"
        log_info "Install jq for JSON processing"
        exit 1
    fi
}
