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
        gh repo view $repo_spec --json owner -q .owner.login
    fi
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
