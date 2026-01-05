#!/bin/bash
# git-operations.bash
# Version: 1.0.0
# Purpose: Reusable Git and GitHub PR operations library
# Description: Centralized functions for PR operations, branch management, git hygiene checks
# Requirements: Bash 4.0+, git, gh CLI
# Author: WorkInProgress.ai

# Guard against multiple sourcing
if [ -n "${_GIT_OPERATIONS_LOADED:-}" ]; then return 0; fi
readonly _GIT_OPERATIONS_LOADED=1

# Source dependencies
# shellcheck disable=SC1091
if [ -f "$DEVENV_ROOT/tools/lib/error-handling.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/error-handling.bash"
fi

# shellcheck disable=SC1091
if [ -f "$DEVENV_ROOT/tools/lib/github-helpers.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/github-helpers.bash"
fi

# shellcheck disable=SC1091
if [ -f "$DEVENV_ROOT/tools/lib/validation.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/validation.bash"
fi

# ============================================================================
# Git Context & State Functions
# ============================================================================

# Get current git branch
# Returns: Current branch name
get_current_branch() {
    git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""
}

# Check if inside git repository
# Returns: 0 if in git repo, 1 otherwise
is_in_git_repo() {
    git rev-parse --is-inside-work-tree >/dev/null 2>&1
}

# Check if working directory has uncommitted changes
# Returns: 0 if clean, 1 if there are changes
is_working_directory_clean() {
    git diff-index --quiet HEAD -- 2>/dev/null
}

# Check if current branch matches pattern
# Args: $1 - branch name to check
# Returns: 0 if matches, 1 otherwise
is_branch_name() {
    local branch="${1:-}"
    [ -n "$branch" ] && [ "$(get_current_branch)" = "$branch" ]
}

# Check if branch name matches pattern (glob)
# Args: $1 - pattern (e.g., "review/*")
# Returns: 0 if matches, 1 otherwise
branch_matches_pattern() {
    local pattern="${1:-}"
    local current_branch
    current_branch=$(get_current_branch)
    # shellcheck disable=SC2053
    [[ "$current_branch" == $pattern ]]
}

# ============================================================================
# Git Branch Management Functions
# ============================================================================

# Get repository root directory
# Returns: Root directory path
get_repo_root() {
    git rev-parse --show-toplevel 2>/dev/null || pwd
}

# Get default branch (main or master)
# Args: $1 - optional repo spec (e.g., "-R owner/repo")
# Returns: Default branch name
get_default_branch() {
    local repo_spec="${1:-}"
    git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || echo "main"
}

# Check if branch exists locally
# Args: $1 - branch name
# Returns: 0 if exists, 1 otherwise
branch_exists_local() {
    local branch="${1:-}"
    [ -n "$branch" ] && git rev-parse --verify --quiet "refs/heads/$branch" >/dev/null 2>&1
}

# Check if branch exists on remote
# Args: $1 - branch name
# Args: $2 - remote (default: origin)
# Returns: 0 if exists, 1 otherwise
branch_exists_remote() {
    local branch="${1:-}"
    local remote="${2:-origin}"
    [ -n "$branch" ] && git rev-parse --verify --quiet "refs/remotes/$remote/$branch" >/dev/null 2>&1
}

# Delete branch locally and remotely
# Args: $1 - branch name
# Args: $2 - remote (default: origin)
# Returns: 0 on success, 1 on failure
delete_branch() {
    local branch="${1:-}"
    local remote="${2:-origin}"
    
    [ -n "$branch" ] || { log_error "Branch name required"; return 1; }
    
    # Delete remote branch
    if branch_exists_remote "$branch" "$remote"; then
        git push "$remote" :"$branch" &>/dev/null || log_warn "Failed to delete remote branch $remote/$branch"
    fi
    
    # Delete local branch
    if branch_exists_local "$branch"; then
        git branch -D "$branch" &>/dev/null || log_warn "Failed to delete local branch $branch"
    fi
    
    return 0
}

# ============================================================================
# PR Discovery & Linking Functions
# ============================================================================

# Find open PR from branch to target
# Args: $1 - source branch (head)
# Args: $2 - target branch (base)
# Args: $3 - optional repo spec (e.g., "-R owner/repo")
# Returns: PR number or empty if not found
find_pr_by_branches() {
    local head_branch="${1:-}"
    local base_branch="${2:-}"
    local repo_spec="${3:-}"
    
    # shellcheck disable=SC2015
    [ -n "$head_branch" ] && [ -n "$base_branch" ] || { log_error "Head and base branches required"; return 1; }
    
    local repo_args=()
    if [ -n "$repo_spec" ]; then
        read -ra repo_args <<< "$repo_spec"
    fi
    
    gh pr list "${repo_args[@]}" --head "$head_branch" --base "$base_branch" --state open \
        --json number --jq '.[0].number' 2>/dev/null || echo ""
}

# Get PR details by number
# Args: $1 - PR number
# Args: $2 - optional repo spec
# Returns: JSON with PR details (title, body, isDraft, state, author, etc.)
get_pr_details() {
    local pr_num="${1:-}"
    local repo_spec="${2:-}"
    
    [ -n "$pr_num" ] || { log_error "PR number required"; return 1; }
    
    local repo_args=()
    if [ -n "$repo_spec" ]; then
        read -ra repo_args <<< "$repo_spec"
    fi
    
    gh pr view "${repo_args[@]}" "$pr_num" \
        --json title,body,isDraft,state,author --jq . 2>/dev/null || echo ""
}

# Check if PR is draft
# Args: $1 - PR number
# Args: $2 - optional repo spec
# Returns: 0 if draft, 1 otherwise
is_pr_draft() {
    local pr_num="${1:-}"
    local repo_spec="${2:-}"
    
    [ -n "$pr_num" ] || return 1
    
    local details
    details=$(get_pr_details "$pr_num" "$repo_spec")
    [ -z "$details" ] && return 1
    
    [ "$(echo "$details" | jq -r '.isDraft')" = "true" ]
}

# Get issue number from PR description
# Args: $1 - PR number
# Args: $2 - optional repo spec
# Returns: Issue number or empty if not found
extract_issue_from_pr() {
    local pr_num="${1:-}"
    local repo_spec="${2:-}"
    
    [ -n "$pr_num" ] || return 1
    
    local details
    details=$(get_pr_details "$pr_num" "$repo_spec")
    [ -z "$details" ] && return 1
    
    echo "$details" | jq -r '.body // ""' | grep -Eo '#[0-9]+' | head -n1 | tr -d '#' || echo ""
}

# ============================================================================
# PR State & Validation Functions
# ============================================================================

# Validate conventional commits format
# Args: $1 - commit message title line
# Returns: 0 if valid, 1 otherwise
validate_conventional_commits() {
    local title="${1:-}"
    [ -n "$title" ] || return 1
    
    local regex='^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert|merge|patch|minor|major)(\([^)]+\))?(!)?: .+'
    [[ "$title" =~ $regex ]]
}

# Validate git context (repo, clean WD, not on target branch)
# Args: $1 - repo directory (optional, default: pwd)
# Args: $2 - exclude branches (pipe-separated, e.g., "main|master")
# Returns: 0 if valid, 1 otherwise
validate_git_context() {
    local repo_dir="${1:-.}"
    local exclude_branches="${2:-}"
    
    cd "$repo_dir" 2>/dev/null || { log_error "Failed to change to directory: $repo_dir"; return 1; }
    
    # Check if in git repo
    if ! is_in_git_repo; then
        log_error "Not in a git repository"
        return 1
    fi
    
    # Check for uncommitted changes
    if ! is_working_directory_clean; then
        log_error "Working directory has uncommitted or staged changes"
        return 1
    fi
    
    # Check if on excluded branch
    if [ -n "$exclude_branches" ]; then
        local current_branch
        current_branch=$(get_current_branch)
        if [[ "$current_branch" == @($exclude_branches) ]]; then
            log_error "Cannot run this script on $current_branch branch"
            return 1
        fi
    fi
    
    return 0
}

# ============================================================================
# Commit Message Building Functions
# ============================================================================

# Build merge commit message with footer
# Args: $1 - commit title
# Args: $2 - commit body (optional)
# Args: $3 - PR number
# Args: $4 - issue number (optional)
# Returns: Full formatted commit message
build_merge_commit_message() {
    local title="${1:-}"
    local body="${2:-}"
    local pr_num="${3:-}"
    local issue_num="${4:-}"
    
    # shellcheck disable=SC2015
    [ -n "$title" ] && [ -n "$pr_num" ] || { log_error "Title and PR number required"; return 1; }
    
    # Trim body if provided
    local trimmed_body=""
    if [ -n "$body" ]; then
        trimmed_body=$(printf "%s" "$body" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | awk 'NF' ORS=$'\n')
        if [ -n "$trimmed_body" ]; then
            trimmed_body="${trimmed_body}

"
        fi
    fi
    
    # Build footer
    local footer="#$pr_num"
    [ -n "$issue_num" ] && footer="$footer #$issue_num"
    
    # Build final message
    printf "%s\n\n%s   %s\n" "$title" "$trimmed_body" "$footer"
}

# ============================================================================
# PR Merge Operations
# ============================================================================

# Merge PR with squash
# Args: $1 - PR number
# Args: $2 - commit message
# Args: $3 - optional repo spec
# Returns: 0 on success, 1 on failure
merge_pr_squash() {
    local pr_num="${1:-}"
    local commit_msg="${2:-}"
    local repo_spec="${3:-}"
    
    # shellcheck disable=SC2015
    [ -n "$pr_num" ] && [ -n "$commit_msg" ] || { log_error "PR number and commit message required"; return 1; }
    
    local repo_args=()
    if [ -n "$repo_spec" ]; then
        read -ra repo_args <<< "$repo_spec"
    fi
    
    log_info "Merging PR $pr_num with squash..."
    gh pr merge "${repo_args[@]}" "$pr_num" --squash --delete-branch --body "$commit_msg" 2>&1
}

# ============================================================================
# Export Functions
# ============================================================================

# Make functions available for sourcing
export -f get_current_branch
export -f is_in_git_repo
export -f is_working_directory_clean
export -f is_branch_name
export -f branch_matches_pattern
export -f get_repo_root
export -f get_default_branch
export -f branch_exists_local
export -f branch_exists_remote
export -f delete_branch
export -f find_pr_by_branches
export -f get_pr_details
export -f is_pr_draft
export -f extract_issue_from_pr
export -f validate_conventional_commits
export -f validate_git_context
export -f build_merge_commit_message
export -f merge_pr_squash
