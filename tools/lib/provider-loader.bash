#!/bin/bash
# provider-loader.bash - provider-module loader and generic repo/PR helpers.
# The single provider-loading entry point for scripts: sources provider-core
# plus every domain module (via provider_load), and carries the repo-target
# and workflow-wait helpers shared across wrappers.
# Requirements: Bash 4.0+, gh CLI (transport lives in the provider modules)
# Author: WorkInProgress.ai

# Prevent multiple sourcing
if [ -n "${_PROVIDER_LOADER_LOADED:-}" ]; then
    return 0
fi
readonly _PROVIDER_LOADER_LOADED=1

# Org identity is org policy: resolve via the policy layer
# (POLICY_ORG -> config [organization] org).
_policy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/policy" 2>/dev/null && pwd)"
if [ -n "$_policy_dir" ] && [ -f "$_policy_dir/policy-core.bash" ]; then
    # shellcheck disable=SC1090,SC1091
    source "$_policy_dir/policy-core.bash"
    policy_core_init "${DEVENV_ROOT:-}/devenv.config" 2>/dev/null || true
    # shellcheck disable=SC1090,SC1091
    source "$_policy_dir/identity-policy.bash"
fi


# Provider layer: load provider-core plus every domain module this lib's
# helpers can reach — through the one canonical loader (provider_load).
# Without the auth module the credential lifecycle verbs fail "does not
# implement" even for a working provider; auth gating in scripts and the
# bootstrap seed import both depend on it.
_gh_self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$_gh_self_dir/providers/provider-core.bash" ]; then
    # shellcheck disable=SC1091
    source "$_gh_self_dir/providers/provider-core.bash"
    provider_load issues prs repos pipelines projects org urls auth
fi
unset _gh_self_dir

# ============================================================================
# GitHub CLI Helpers
# ============================================================================

# Build repository specification for gh CLI commands
# 
# This function determines the appropriate repository specification for gh CLI
# commands that accept the -R flag. It tries multiple sources in order:
#   1. DEVENV_REPO environment variable (explicit override)
#   2. config org + current repository name (constructed from context)
#   3. Empty (falls back to git context)
#
# Usage:
#   local repo_spec
#   read -ra repo_spec <<< "$(get_repo_spec)"
#   gh issue list "${repo_spec[@]}" --state open
#
# Environment Variables:
#   DEVENV_REPO    - Full repository specification in format "owner/repo"
#   (org identity resolves via the provider org accessor)
# Returns:
#   Outputs "-R owner/repo" if repository can be determined, empty string otherwise
#
get_repo_spec() {
    # Repo targeting: DEVENV_REPO is the single override.
    if [ -n "${DEVENV_REPO:-}" ]; then
        echo "-R" "$DEVENV_REPO"
        return
    fi
    
    # Otherwise, try to construct from the policy org and current repo
    local policy_org
    policy_org=$(policy_org 2>/dev/null || true)
    if [ -n "$policy_org" ]; then
        local repo_name
        repo_name=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
        if [ -n "$repo_name" ]; then
            echo "-R" "${policy_org}/${repo_name}"
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
#   1. The policy org (config [organization] org; POLICY_ORG override)
#   2. gh repo view query (requires gh CLI access)
#
# Usage:
#   owner=$(get_repo_owner)
#
# Environment Variables:
#   (org identity resolves via the provider org accessor; GITHUB_ORG is not read)
#
# Returns:
#   Outputs the owner name, exits with error if cannot be determined
#
get_repo_owner() {
    local policy_org
    policy_org=$(policy_org 2>/dev/null || true)
    if [ -n "$policy_org" ]; then
        echo "$policy_org"
    else
        # No -R flag: resolves the repository from the current directory's
        # git remote. A basename-only -R spec is rejected by gh.
        provider_repos_view "" --json owner -q .owner.login
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
    full_name=$(provider_repos_view "" --json nameWithOwner -q .nameWithOwner 2>/dev/null) || {
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
# The gh credential store (keychain) is the single auth source; there is
# no env-token login path. Re-authentication is `key-update-git` or the
# provider's own login flow.
# (github.com as hostname, ssh as git protocol).
#
# Usage:
#   ensure_gh_login
#
# Returns:
#   0 if authenticated successfully; 1 if authentication fails. Callers run
#   under set -e, so an unguarded call terminates the script on failure.
#
ensure_gh_login() {
    # Auth state resolves through the provider seam (the active provider's
    # auth module owns the concrete credential CLI).
    if provider_auth_status &>/dev/null; then
        return 0
    fi

    echo "Error: provider CLI is not authenticated. Run: key-update-git" >&2
    return 1
}

# Check required dependencies for GitHub CLI operations
#
# This function validates that all required tools for GitHub operations
# are installed and properly configured:
#   - gh: GitHub CLI
#   - provider authentication: must be logged in
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
        return 1
    fi

    if ! provider_auth_status &> /dev/null; then
        log_error "Not authenticated with the provider CLI"
        log_info "Run: key-update-git"
        return 1
    fi

    if ! command -v jq &> /dev/null; then
        log_error "jq is not installed or not in PATH"
        log_info "Install jq for JSON processing"
        return 1
    fi
}

# ============================================================================
# GitHub Actions Workflow Monitoring
# ============================================================================

# Wait for all in-progress GitHub Actions runs to complete for a repository.
#
# Polls `gh run list` until no runs are queued or in_progress on the given
# branch, then returns. Useful for waiting on CI after merging a PR before
# proceeding to the next step.
#
# Arguments:
#   $1 - Repository in "owner/repo" format (required)
#   $2 - Branch to monitor (default: master)
#   $3 - Poll interval in seconds (default: 15)
#   $4 - Timeout in seconds (default: 600)
#
# Returns:
#   0 if all runs completed successfully
#   1 if any run failed/cancelled
#   2 if timeout reached
#
wait_for_workflow_runs() {
    local repo="${1:-}"
    local branch="${2:-master}"
    local interval="${3:-15}"
    local timeout="${4:-600}"

    [ -n "$repo" ] || { log_error "Repository (owner/repo) required"; return 1; }

    local elapsed=0

    while [ "$elapsed" -lt "$timeout" ]; do
        local active_count
        active_count=$(provider_pipelines_run_list "$repo" --branch "$branch" --limit 10 \
            --json status --jq '[.[] | select(.status == "queued" or .status == "in_progress" or .status == "waiting" or .status == "pending" or .status == "requested")] | length' 2>/dev/null) || active_count=0

        if [ "$active_count" -eq 0 ]; then
            # No active runs — check if the most recent run succeeded
            local latest_conclusion
            latest_conclusion=$(provider_pipelines_run_list "$repo" --branch "$branch" --limit 1 \
                --json conclusion --jq '.[0].conclusion // empty' 2>/dev/null) ||
 true

            if [ "$latest_conclusion" = "failure" ] || [ "$latest_conclusion" = "cancelled" ]; then
                log_warn "Latest workflow run on $repo ($branch) concluded: $latest_conclusion"
                return 1
            fi
            return 0
        fi

        log_info "Waiting for $active_count workflow run(s) on $repo ($branch)... [${elapsed}s/${timeout}s]"
        sleep "$interval"
        elapsed=$((elapsed + interval))
    done

    log_warn "Timeout (${timeout}s) waiting for workflow runs on $repo ($branch)"
    return 2
}

# Wait for workflow runs to complete across multiple repositories.
#
# Calls wait_for_workflow_runs for each repo. Collects failures and reports
# a summary at the end.
#
# Arguments:
#   $1 - Branch to monitor (default: master)
#   $2 - Poll interval in seconds (default: 15)
#   $3 - Timeout in seconds (default: 600)
#   $4..N - Repositories in "owner/repo" format
#
# Returns:
#   0 if all repos' runs completed successfully
#   1 if any failed
#
wait_for_workflow_runs_multi() {
    local branch="${1:-master}"
    local interval="${2:-15}"
    local timeout="${3:-600}"
    shift 3

    local -a repos=("$@")
    local -a failed=()

    for repo in "${repos[@]}"; do
        log_info "Monitoring workflow runs for $repo..."
        if ! wait_for_workflow_runs "$repo" "$branch" "$interval" "$timeout"; then
            failed+=("$repo")
        fi
    done

    if [ "${#failed[@]}" -gt 0 ]; then
        log_warn "Workflow runs failed or timed out for: ${failed[*]}"
        return 1
    fi

    log_info "All workflow runs completed successfully"
    return 0
}

# Cancel any active GitHub Actions workflow runs on a branch.
#
# Finds all queued/in-progress/pending runs on the given branch and cancels
# them. Silently ignores failures — this is best-effort.
#
# Arguments:
#   $1 - Repository in "owner/repo" format (required)
#   $2 - Branch to cancel runs on (required)
#
# Returns:
#   0 always (best-effort, failures are silently ignored)
#
cancel_branch_workflow_runs() {
    local repo="${1:-}"
    local branch="${2:-}"

    [ -n "$repo" ] && [ -n "$branch" ] || { log_error "Repository and branch required"; return 1; }

    local run_ids
    run_ids=$(provider_pipelines_run_list "$repo" --branch "$branch" --limit 10 \
        --json databaseId,status \
        --jq '[.[] | select(.status == "queued" or .status == "in_progress" or .status == "waiting" or .status == "pending" or .status == "requested")] | .[].databaseId' 2>/dev/null) || return 0

    local id
    for id in $run_ids; do
        provider_pipelines_run_cancel "$repo" "$id" 2>/dev/null && \
            log_info "Cancelled workflow run $id on $branch" || true
    done
}

# Ensure a label exists in a GitHub repository, creating it if absent.
# Usage: ensure_label LABEL [REPO_SPEC...]
#   LABEL      The label name to ensure exists
#   REPO_SPEC  Optional repo spec args (e.g. -R owner/repo). Defaults to current repo.
# Returns:
#   0 always (best-effort, creation failures are silently ignored)
#
ensure_label() {
    local label="${1:-}"
    [ -n "$label" ] || { log_error "Label name required"; return 1; }
    shift
    # Distinctly-named local array: reusing a name like repo_spec here
    # leaks array type into every file that sources this lib when the
    # linter follows sources, tripping SC2178/SC2128 elsewhere.
    local -a label_repo_spec=("$@")

    # provider_issues_label_ensure is idempotent (list-then-create internal).
    # It takes [repo] as its first arg; strip a leading -R flag pair.
    local repo=""
    if [ "${label_repo_spec[0]:-}" = "-R" ]; then
        repo="${label_repo_spec[1]:-}"
    fi
    provider_issues_label_ensure "$repo" "$label" "ededed" "Automated process" 2>/dev/null || true
}

# resolve_target_repo [REPO_OVERRIDE]
#
# Single repo-resolution entry point. Resolution order:
#   1. REPO_OVERRIDE argument (maps a --repo flag)
#   2. DEVENV_REPO environment variable
#   3. config org + current git repo basename
# Then applies the devenv-repo safety gate (check_target_repo semantics:
# refuses to operate on the devenv repo itself unless ALLOW_DEVENV_REPO=1
# or DEVENV_REPO explicitly targets it).
#
# On success: exports GH_REPO=<owner>/<repo> and prints the resolved
# "owner/repo". On refusal: exits (gate behavior). Callers that pass the
# result to `gh -R` can use the printed value directly.
# GH_REPO ownership: the variable is transport state the provider layer
# owns (child gh processes resolve it natively); this export propagates the
# provider's resolution result — callers never set or read it directly.
resolve_target_repo() {
    local repo_override="${1:-}"
    local repo=""

    # Resolution delegates to the provider layer (provider_repo_target):
    # explicit arg → DEVENV_REPO → full-form GH_REPO → org + cwd basename.
    repo=$(provider_repo_target "$repo_override")

    if [ -z "$repo" ]; then
        log_error "Unable to resolve target repository"
        log_info "Prefix the command with DEVENV_REPO=<owner>/<repo> or run from within the target repo"
        exit 1
    fi

    # Safety gate: reuse check_target_repo semantics by pointing the env at
    # the resolved repo for the duration of the check. The gate lives in
    # git-operations.bash — a caller that has not sourced it is a caller that
    # would silently bypass the devenv-repo protection, so that is a hard
    # error, never a warning.
    if ! declare -F check_target_repo > /dev/null; then
        log_error "resolve_target_repo requires git-operations.bash (safety gate); source it before calling"
        exit 1
    fi
    # The gate needs the override visible to check_target_repo; restore the
    # caller's value afterward so a non-subshell caller inherits no leak.
    local saved_repo="${DEVENV_REPO:-}"
    DEVENV_REPO="$repo"
    check_target_repo
    if [ -n "$saved_repo" ]; then
        DEVENV_REPO="$saved_repo"
    else
        unset DEVENV_REPO
    fi

    export GH_REPO="$repo"
    printf '%s\n' "$repo"
}
