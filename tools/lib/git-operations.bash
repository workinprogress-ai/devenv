#!/bin/bash
# git-operations.bash
# Version: 1.0.0
# Purpose: Reusable Git and GitHub PR operations library
# Version: 1.0.0
# Purpose: Reusable Git and GitHub PR operations library
# Description: Centralized functions for PR operations, branch management, git hygiene checks
# Requirements: Bash 4.0+, git, gh CLI
# Author: WorkInProgress.ai

# Guard against multiple sourcing
if [ -n "${_GIT_OPERATIONS_LOADED:-}" ]; then return 0; fi
readonly _GIT_OPERATIONS_LOADED=1

# Self-locate this checkout (self-root contract: self-location wins;
# a foreign exported DEVENV_ROOT is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/self-root.bash"
devenv_ensure_root "${BASH_SOURCE[0]}"

# Source dependencies
# shellcheck disable=SC1091
if [ -f "${DEVENV_ROOT}/tools/lib/error-handling.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/error-handling.bash"
fi

# shellcheck disable=SC1091
if [ -f "${DEVENV_ROOT}/tools/lib/provider-loader.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/provider-loader.bash"
fi

# shellcheck disable=SC1091
if [ -f "${DEVENV_ROOT}/tools/lib/validation.bash" ]; then
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
# Returns: Default branch name
get_default_branch() {
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
    
    local prov_repo=""
    [ -n "$repo_spec" ] && prov_repo="$(echo "$repo_spec" | sed 's/^-R //')"
    provider_prs_list "$prov_repo" --head "$head_branch" --base "$base_branch" --state open \
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
    
    local prov_repo=""
    [ -n "$repo_spec" ] && prov_repo="$(echo "$repo_spec" | sed 's/^-R //')"
    provider_prs_view "$prov_repo" "$pr_num" \
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
    
    # Build footer refs
    local refs="#$pr_num"
    [ -n "$issue_num" ] && refs="$refs #$issue_num"
    
    # Build final message: title with PR ref inline, then body (if any)
    local subject="$title ($refs)"
    if [ -n "$trimmed_body" ]; then
        printf "%s\n\n%s\n" "$subject" "$trimmed_body"
    else
        printf "%s\n" "$subject"
    fi
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
    
    log_info "Merging PR $pr_num with squash..."
    local prov_repo=""
    [ -n "$repo_spec" ] && prov_repo="$(echo "$repo_spec" | sed 's/^-R //')"
    provider_prs_merge "$prov_repo" "$pr_num" --squash --delete-branch --body "$commit_msg" 2>&1
}

# Merge PR with a specified method (squash, merge, or rebase)
# Args: $1 - PR number
# Args: $2 - commit message
# Args: $3 - merge method (squash, merge, rebase)
# Args: $4 - optional repo spec
# Args: $5 - optional "true" to force merge with --admin (bypass checks)
# Returns: 0 on success, 1 on failure
merge_pr() {
    local pr_num="${1:-}"
    local commit_msg="${2:-}"
    local method="${3:-squash}"
    local repo_spec="${4:-}"
    local force="${5:-false}"
    
    # shellcheck disable=SC2015
    [ -n "$pr_num" ] && [ -n "$commit_msg" ] || { log_error "PR number and commit message required"; return 1; }
    
    case "$method" in
        squash|merge|rebase) ;;
        *) log_error "Invalid merge method: $method (must be squash, merge, or rebase)"; return 1 ;;
    esac
    
    local subject body
    subject="$(printf "%s" "$commit_msg" | head -n1)"
    body="$(printf "%s" "$commit_msg" | tail -n +2 | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

    local merge_args=("$pr_num" --"$method" --delete-branch --subject "$subject" --body "$body")
    if [ "$force" = "true" ]; then
        merge_args+=(--admin)
        log_info "Merging PR $pr_num with $method (--admin)..."
    else
        log_info "Merging PR $pr_num with $method..."
    fi
    
    local merge_output
    local prov_repo_merge=""
    [ -n "$repo_spec" ] && prov_repo_merge="${repo_spec#-R }"
    if ! merge_output=$(provider_prs_merge "$prov_repo_merge" "${merge_args[@]}" 2>&1); then
        printf '%s\n' "$merge_output"
        return 1
    fi
    printf '%s\n' "$merge_output"

    # Fire skill event signals for issues linked in the merged PR body.
    # Best-effort - never alters this function's success.
    if [ -n "${_PR_EVENTS_LOADED:-}" ] || source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pr-events.bash" 2>/dev/null; then
        local pr_body
        pr_body=$(provider_prs_view "${repo_spec#-R }" "$pr_num" --json body --jq '.body' 2>/dev/null || true)
        pr_events_signal merged "$pr_body" || true
    fi
    return 0
}

# ============================================================================
# Git Configuration Functions (from git-config.bash)
# ============================================================================

# Extract the owner part from a repo spec or https URL.
# Accepts: owner/repo, https://host/owner/repo(.git),
#          https://user:token@host/owner/repo(.git)
# Prints the owner; prints nothing and returns 1 when the input is
# unparseable (caller decides foreign handling per the ambiguity rule).
repo_url_owner() {
    local spec="$1"
    local path_part=""

    case "$spec" in
        *"://"*"@"*)
            # https://user:token@host/owner/repo(.git) — strip scheme+creds+host
            path_part="${spec#*://*@*/}"
            ;;
        *"://"*"/"*)
            # https://host/owner/repo(.git)
            path_part="${spec#*://*/}"
            ;;
        git@*:*)
            # git@host:owner/repo(.git) — SSH form
            path_part="${spec#*:}"
            ;;
        *)
            path_part="$spec"
            ;;
    esac
    # Strip trailing .git
    path_part="${path_part%.git}"
    # A valid form is owner/repo — require both parts
    case "$path_part" in
        */*/*) path_part="${path_part%/*}" ;;  # tolerate deeper paths: owner/repo/extra
        */*) : ;;
        *) return 1 ;;  # no owner/repo structure — unparseable
    esac
    printf '%s\n' "${path_part%%/*}"
}

# Resolve the configured GitHub org: GH_ORG env first, then
# devenv.config [organization] github_org. Prints the org; returns 1 when
# neither is set (ambiguity — callers treat the repo as foreign).
repo_configured_org() {
    # Single org chain: delegate to the policy layer (POLICY_ORG → provider
    # accessor → config → seed). No local re-implementation here.
    policy_org 2>/dev/null
}

# Membership check: is this repo owned by the configured org?
# Ambiguity (no org configured, unparseable spec) is treated as NOT a member
# with a warning — safety-first: foreign repos are never URL-rewritten.
#
# Usage:
#   if repo_is_org_member "https://user:token@github.com/myorg/myrepo.git"; then
#       ... rewrite allowed ...
#   fi
repo_is_org_member() {
    local spec="$1"
    local owner org

    org=$(repo_configured_org) || {
        log_warn "repo_is_org_member: no GitHub org configured (devenv.config [organization] org) — treating repo as foreign"
        return 1
    }
    owner=$(repo_url_owner "$spec") || {
        log_warn "repo_is_org_member: cannot parse owner from '$spec' — treating repo as foreign"
        return 1
    }
    [ "$owner" = "$org" ]
}

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
    
    # Update remote URL if provided — but never rewrite a foreign repo's
    # remote. The guard checks the CURRENT origin: the mangle scenario is
    # repointing an existing foreign repo's remote at an org URL. Ambiguity
    # is treated as foreign (safety-first); org config or new-URL membership
    # is not consulted for the rewrite decision.
    if [ -n "$remote_url" ]; then
        local current_origin
        current_origin=$(git remote get-url origin 2>/dev/null || echo "")
        if [ -n "$current_origin" ] && ! repo_is_org_member "$current_origin"; then
            log_warn "configure_git_repo: foreign repo (origin '$current_origin') — skipping remote URL rewrite"
        else
            git remote set-url origin "$remote_url"
        fi
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

    # Note: no global core.hooksPath installation here. Repos carry their own
    # husky hooks (each self-installing the devenv wip-gate block), so a global
    # hooksPath would override per-repo hooks with one shared directory.

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

# Check if the current directory is inside the devenv repository (canonical test)
#
# Single source of truth for devenv-repo detection. Matches on EITHER:
#   - the marker file .devcontainer/bootstrap.sh at the git root, OR
#   - the git root directory being named "devenv"
# Either signal alone counts — the marker survives renames, the name survives
# partial checkouts — so all devenv-repo tests agree instead of diverging
# per call site.
#
# Usage:
#   if is_devenv_repo; then
#       echo "In devenv repo"
#   fi
#
# Returns:
#   0 if inside the devenv repository, 1 otherwise (including not-in-git)
#
is_devenv_repo() {
    local git_root
    git_root=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
    [ -f "$git_root/.devcontainer/bootstrap.sh" ] || [ "$(basename "$git_root")" = "devenv" ]
}

# Check whether the current repo is a devenv clone nested below a repos/
# directory (e.g. <workspace>/repos/devenv). Such clones are deliberate
# devenv-development targets, so wrappers may operate on them without the
# --devenv override. The canonical workspace devenv root (whose parent is the
# workspace folder, not repos/) keeps the guard.
#
# Returns:
#   0 if the git root's parent directory is named "repos", 1 otherwise
#
is_nested_devenv_clone() {
    local git_root
    git_root=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
    [ "$(basename "$(dirname "$git_root")")" = "repos" ]
}

# Check if we're in the devenv repo and validate permissions
# Uses the global variable ALLOW_DEVENV_REPO (should be set by calling script)
# Detection delegates to is_devenv_repo (canonical test).
# Nested devenv clones below a repos/ directory are auto-allowed: being
# cd'ed into <anywhere>/repos/devenv is itself the deliberate devenv-target
# signal, so the --devenv flag is not required there.
# Args: none (uses $ALLOW_DEVENV_REPO global)
check_target_repo() {
    local git_root
    git_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
        log_error "Not in a git repository"
        exit 1
    }

    # Canonical devenv-repo test — same predicate everywhere
    if is_devenv_repo; then
        if [ -z "${DEVENV_REPO:-}" ]; then
            if is_nested_devenv_clone; then
                log_info "Operating on a devenv clone below repos/ — no --devenv override needed"
            elif [ "${ALLOW_DEVENV_REPO:-0}" -eq 0 ]; then
                log_error "The current repository appears to be the devenv repository itself"
                log_info "Operations should be performed in target project repositories, not in devenv"
                log_info "To target a project repo, prefix the command with DEVENV_REPO=<owner>/<repo>"
                log_info "To override this safety check (devenv-repo work only), pass the --devenv flag"
                exit 1
            else
                log_warn "Performing operation in devenv repository (safety override enabled)"
            fi
        fi
    fi
}

# ============================================================================
# GitHub Repository Protection
# ============================================================================

# Configure branch protection for a GitHub repository
#
# Applies branch protection rules to a specified branch (typically master/main)
# using the GitHub API via gh CLI. Supports comprehensive protection settings
# including PR requirements, reviews, status checks, and merge restrictions.
#
# Usage:
#   configure_branch_protection "owner/repo" "master" '{...protection settings...}'
#   configure_branch_protection "$full_repo_name" "$branch_name" "$protection_json"
#
# Arguments:
#   $1 - Full repository name (owner/repo format, required)
#   $2 - Branch name to protect (required, e.g., "master", "main")
#   $3 - JSON protection payload with settings (required)
#
# Protection Payload Fields:
#   required_status_checks         - Status checks configuration (object or null)
#   enforce_admins                 - Whether to enforce rules for admins (bool)
#   required_pull_request_reviews  - PR review requirements (object)
#   restrictions                   - Push restrictions (object or null)
#   allow_force_pushes             - Allow force pushes (bool)
#   allow_deletions                - Allow branch deletion (bool)
#   required_conversation_resolution - Require conversation resolution (bool)
#
# Returns:
#   0 on success, 1 on failure
#   Outputs success/warning message to stdout
#
# Examples:
#   protection_payload='{
#     "required_status_checks": null,
#     "enforce_admins": false,
#     "required_pull_request_reviews": {
#       "required_approving_review_count": 1,
#       "require_code_owner_reviews": true,
#       "dismiss_stale_reviews": true
#     },
#     "restrictions": null,
#     "allow_force_pushes": false,
#     "allow_deletions": false,
#     "required_conversation_resolution": true
#   }'
#   configure_branch_protection "myorg/myrepo" "master" "$protection_payload"
#
# Notes:
#   - Requires gh CLI authentication with repo admin permissions
#   - Branch must exist before protection can be applied
#   - Settings are applied atomically; partial updates not supported
#
configure_branch_protection() {
    local full_name="$1"
    local branch_name="$2"
    local protection_payload="$3"
    
    if [ -z "$full_name" ] || [ -z "$branch_name" ] || [ -z "$protection_payload" ]; then
        echo "ERROR: full_name, branch_name, and protection_payload are required" >&2
        return 1
    fi
    
    # Apply branch protection (provider verb consumes a payload file)
    local payload_file
    payload_file=$(mktemp)
    printf '%s' "$protection_payload" > "$payload_file"
    if provider_repos_protect_branch "$full_name" "$branch_name" "$payload_file"; then
        rm -f "$payload_file"
        echo "  ✓ Branch protection configured for $branch_name"
        return 0
    else
        echo "  WARNING: Could not configure branch protection (branch may not exist yet)"
        echo "  Run this after pushing your first commit to $branch_name"
        rm -f "$payload_file"
        return 1
    fi
}

# Set repository-level settings via GitHub API
#
# Updates repository-level settings such as delete_branch_on_merge, wikis,
# issues, projects, etc. using the GitHub API via gh CLI.
#
# Usage:
#   set_repo_setting "owner/repo" "delete_branch_on_merge" "true"
#   set_repo_setting "$full_repo_name" "has_wiki" "false"
#
# Arguments:
#   $1 - Full repository name (owner/repo format, required)
#   $2 - Setting name (required, see GitHub API docs for valid fields)
#   $3 - Setting value (required, typically "true"/"false" or string)
#
# Returns:
#   0 on success, 1 on failure
#   Outputs success/warning message to stdout
#
# Examples:
#   set_repo_setting "myorg/myrepo" "delete_branch_on_merge" "true"
#   set_repo_setting "myorg/myrepo" "has_issues" "true"
#   set_repo_setting "myorg/myrepo" "default_branch" "main"
#
# Notes:
#   - Requires gh CLI authentication with repo admin permissions
#   - Uses PATCH method to update only specified fields
#   - See GitHub API docs for complete list of available settings
#
set_repo_setting() {
    local full_name="$1"
    local setting_name="$2"
    local setting_value="$3"
    
    if [ -z "$full_name" ] || [ -z "$setting_name" ] || [ -z "$setting_value" ]; then
        echo "ERROR: full_name, setting_name, and setting_value are required" >&2
        return 1
    fi
    
    if provider_repos_patch "$full_name" -f "${setting_name}=${setting_value}" >/dev/null 2>&1; then
        echo "  ✓ Repository setting '$setting_name' set to '$setting_value'"
        return 0
    else
        echo "  WARNING: Could not set repository setting '$setting_name'"
        return 1
    fi
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
export -f merge_pr
export -f configure_git_repo
export -f configure_git_global
export -f add_git_safe_directory
export -f check_target_repo
export -f configure_branch_protection
export -f set_repo_setting
