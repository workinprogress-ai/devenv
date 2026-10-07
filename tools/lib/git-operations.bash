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

# Get the remote's default branch: origin/HEAD when it is set, else whichever of
# origin/main and origin/master exists, else master. Never fails, so a caller running
# under set -e / pipefail is not aborted by a repository whose origin/HEAD is unset.
# Returns: Default branch name
get_default_branch() {
    local ref
    ref=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null) || ref=""
    ref="${ref#origin/}"
    if [ -z "$ref" ]; then
        if git show-ref --quiet refs/remotes/origin/main; then
            ref="main"
        else
            ref="master"
        fi
    fi
    printf '%s\n' "$ref"
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

# Delete a branch locally only; the remote copy is left alone.
# Args: $1 - branch name
# Returns: 0 on success (or when the branch does not exist locally), 1 on failure
delete_local_branch() {
    local branch="${1:-}"
    [ -n "$branch" ] || { log_error "Branch name required"; return 1; }
    if branch_exists_local "$branch"; then
        if ! git branch -D "$branch" &>/dev/null; then
            log_warn "Failed to delete local branch $branch"
            return 1
        fi
    fi
    return 0
}

# Delete branch locally and remotely
# Args: $1 - branch name
# Args: $2 - remote (default: origin)
# Returns: 0 on success, 1 on failure
delete_branch() {
    local branch="${1:-}"
    local remote="${2:-origin}"
    
    [ -n "$branch" ] || { log_error "Branch name required"; return 1; }

    # Both legs are always attempted (a failed remote delete must not strand the
    # local branch), and the result reports whether either failed: callers branch
    # on this status, so returning 0 unconditionally made their error handling dead.
    local rc=0

    # Delete remote branch
    if branch_exists_remote "$branch" "$remote"; then
        if ! git push "$remote" :"$branch" &>/dev/null; then
            log_warn "Failed to delete remote branch $remote/$branch"
            rc=1
        fi
    fi

    # Delete local branch
    if branch_exists_local "$branch"; then
        if ! git branch -D "$branch" &>/dev/null; then
            log_warn "Failed to delete local branch $branch"
            rc=1
        fi
    fi

    return "$rc"
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

# The canonical conventional-commit type enum, matching commitlint.config.js
# type-enum (docs/Commit-Conventions.md is the contract). Keep in sync with
# commitlint.config.js — both derive from the same list.
DEVENV_COMMIT_TYPES='feat fix chore docs style refactor perf test build ci revert patch minor major'

# Single source for merge methods the tooling may use. Wrappers validate
# against this list; do not hand-maintain per-script copies.
DEVENV_MERGE_METHODS='squash merge rebase'

# Validate conventional commits format
# Args: $1 - commit message title line
# Returns: 0 if valid, 1 otherwise
validate_conventional_commits() {
    local title="${1:-}"
    [ -n "$title" ] || return 1

    local regex
    regex="^($(echo "$DEVENV_COMMIT_TYPES" | tr ' ' '|'))(\([^)]+\))?(!)?: .+"
    [[ "$title" =~ $regex ]]
}

# Check a merge method against the whitelist
# Args: $1 - method name
# Returns: 0 if allowed, 1 otherwise
merge_method_allowed() {
    local method="${1:-}"
    local m
    for m in $DEVENV_MERGE_METHODS; do
        [ "$m" = "$method" ] && return 0
    done
    return 1
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
        # '|'-separated globs, matched with case: no extglob (and so no
        # dependence on shell options or on how a given bash parses @(...)).
        local excluded_pattern
        local -a excluded_patterns
        IFS='|' read -ra excluded_patterns <<< "$exclude_branches"
        for excluded_pattern in "${excluded_patterns[@]}"; do
            # shellcheck disable=SC2254  # the unquoted pattern is the point: it is a glob
            case "$current_branch" in
                $excluded_pattern)
                    log_error "Cannot run this script on $current_branch branch"
                    return 1
                    ;;
            esac
        done
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

# Merge PR with a specified method (rebase, merge, or squash)
# Args: $1 - PR number
# Args: $2 - commit message
# Args: $3 - merge method (rebase, merge, squash)
# Args: $4 - optional repo spec
# Args: $5 - optional "true" to force merge with --admin (bypass checks)
# Args: $6 - optional "true" to keep the source branch (default deletes)
# Returns: 0 on success, 1 on failure
merge_pr() {
    local pr_num="${1:-}"
    local commit_msg="${2:-}"
    local method="${3:-rebase}"
    local repo_spec="${4:-}"
    local force="${5:-false}"
    local keep_branch="${6:-false}"
    
    # shellcheck disable=SC2015
    [ -n "$pr_num" ] && [ -n "$commit_msg" ] || { log_error "PR number and commit message required"; return 1; }
    
    if ! merge_method_allowed "$method"; then
        log_error "Invalid merge method: $method (must be one of: $DEVENV_MERGE_METHODS)"
        return 1
    fi
    
    local subject body
    subject="$(printf "%s" "$commit_msg" | head -n1)"
    body="$(printf "%s" "$commit_msg" | tail -n +2 | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

    local merge_args=("$pr_num" --"$method" --subject "$subject" --body "$body")
    # Branch deletion is the default; --delete-branch stays omitted only
    # for explicit keep requests (providers map the flag to their own
    # completion semantics; azure reads deleteSourceBranch).
    if [ "$keep_branch" != "true" ]; then
        merge_args+=(--delete-branch)
    fi
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
# Merge-range guards (rebase merge policy — docs/Commit-Conventions.md)
# ============================================================================

# Scan a commit range for WIP: commits (anchored subject prefix, matching
# git-unwip detection). Prints the offending subjects, one per line.
# Args: $1 - range (e.g. "master..HEAD", "master..merge/abc123-branch")
# Returns: 0 if the range is WIP-free, 1 if any WIP: commit is present
wip_range_scan() {
    local range="${1:-}"
    [ -n "$range" ] || { log_error "wip_range_scan: range is required"; return 1; }

    # Match the anchored WIP: prefix on the subject (same model as
    # wip-gate.sh / git-unwip). Never match on hash-relative offsets:
    # short-hash length auto-scales with repo size, so an offset regex
    # would silently stop matching — the gate must not fail open.
    local offenders
    offenders=$(git log "$range" --format='%h %s' 2>/dev/null | grep ' WIP:' || true)
    if [ -n "$offenders" ]; then
        printf '%s\n' "$offenders"
        return 1
    fi
    return 0
}

# Hard-reject guard: fail when the merge range contains WIP: commits.
# The guard range for a merge branch (merge/<short-hash>-<branch>) is
# master..merge/<hash>-* regardless of feature-branch state — merge
# branches must never carry WIP.
# Args: $1 - range; $2 - optional context label for log messages
# Returns: 0 (range clean) or 1 (WIP present — logged and rejected)
wip_range_guard() {
    local range="${1:-}"
    local context="${2:-merge range}"

    local offenders
    if ! offenders=$(wip_range_scan "$range"); then
        log_error "WIP: commits present in ${context} (${range}) — merge rejected."
        log_error "Offending commits:"
        printf '%s\n' "$offenders" | while IFS= read -r line; do
            log_error "  $line"
        done
        log_error "Recovery: git-unwip (soft-reset past the WIP) or finish the work into real commits."
        return 1
    fi
    return 0
}

# Soft warning: list commits in the merge range carrying breaking markers
# (! before the colon or a BREAKING CHANGE footer). Warns only — the human
# confirms each breaking claim is real before the merge proceeds.
# Args: $1 - range
# Returns: 0 always (warning surface, not a gate)
breaking_marker_scan() {
    local range="${1:-}"
    [ -n "$range" ] || return 0

    local breaking
    breaking=$(git log "$range" --format='%h %s' 2>/dev/null \
        | grep -E '^[0-9a-f]{7,} [a-z]+(\([^)]*\))?!:' || true)
    local footer_hits
    footer_hits=$(git log "$range" --format='C %h %s%n%b' 2>/dev/null | awk '
        /^C [0-9a-f]/ { cur = substr($0, 3) }
        /^BREAKING CHANGE[ :=]/ && cur != "" { print cur " (BREAKING CHANGE footer)"; cur = "" }
    ' || true)
    [ -z "$breaking" ] || printf '%s\n' "$breaking" | while IFS= read -r line; do
        log_warn "Breaking marker in range: $line"
    done
    [ -z "$footer_hits" ] || printf '%s\n' "$footer_hits" | while IFS= read -r line; do
        log_warn "Breaking marker in range: $line"
    done
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

# Resolve the configured org: policy chain (POLICY_ORG → provider accessor
# → config → seed). Prints the org; returns 1 when unresolvable
# (ambiguity — callers treat the repo as foreign).
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

# Configure git settings for a local repository.
# Side effect (deliberate): this registers the repository in the GLOBAL
# safe.directory list. git honors safe.directory only from system/global config
# (never repo-local), so a per-repo setting cannot achieve it; the entry is added
# once (idempotent) via add_git_safe_directory. Everything else it writes is
# repo-local.
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
    
    # Global safe.directory entry (see the header): one shared, idempotent helper.
    add_git_safe_directory "$abs_dir"
    
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
    
    # Credential management. No plaintext 'store' helper (it would persist tokens
    # in ~/.git-credentials), and none is needed: provider auth import wires the
    # provider's own, host-scoped credential helper. This cache only spares repeat
    # prompts for hosts without one, and is bounded to a working day.
    git config --global credential.helper 'cache --timeout=28800'
    
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
# Export Functions
# ============================================================================

# Make functions available for sourcing
export -f get_current_branch
export -f is_in_git_repo
export -f is_working_directory_clean
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
export -f merge_pr
export -f configure_git_repo
export -f configure_git_global
export -f add_git_safe_directory
export -f check_target_repo
