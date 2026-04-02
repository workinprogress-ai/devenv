#!/usr/bin/env bash
# repo-cache.bash - Lightweight repository cache for cross-repo analysis
# Version: 1.0.0
# Description: Maintains shallow clones of organization repositories in a local cache
#              for tools that need to inspect multiple repos (e.g. dependency graphs).
# Requirements: Bash 4.0+, git, gh CLI
# Author: WorkInProgress.ai

# Guard against multiple sourcing
if [ -n "${_REPO_CACHE_LOADED:-}" ]; then
    return 0
fi
readonly _REPO_CACHE_LOADED=1

# Source dependencies
if [ -z "${_ERROR_HANDLING_LOADED:-}" ] && [ -f "${DEVENV_TOOLS}/lib/error-handling.bash" ]; then
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/error-handling.bash"
fi

if [ -z "${_REPO_OPERATIONS_LOADED:-}" ] && [ -f "${DEVENV_TOOLS}/lib/repo-operations.bash" ]; then
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/repo-operations.bash"
fi

# Default cache directory (can be overridden before sourcing for testing)
readonly REPO_CACHE_DIR="${REPO_CACHE_DIR:-${DEVENV_TOOLS}/cache/repo_cache}"

# Maximum number of parallel git operations during cache refresh
readonly REPO_CACHE_PARALLEL="${REPO_CACHE_PARALLEL:-5}"

# ============================================================================
# Repository Cache Operations
# ============================================================================

# Refresh the local shallow-clone cache of organization repositories
#
# Clones or updates repositories from the GitHub organization into a local cache
# directory using shallow, single-branch clones for minimal disk usage. Only the
# latest state of the default (master) branch is kept.
#
# New repos are cloned with --depth 1 --single-branch. Existing repos are updated
# with git fetch --depth 1 followed by a hard reset, which is the most
# space-efficient way to bring a shallow clone up to date.
#
# Usage:
#   refresh_repo_cache                          # cache all org repos
#   refresh_repo_cache "service\."              # cache repos matching pattern
#   refresh_repo_cache "^lib\.cs\."             # cache repos matching prefix
#
# Arguments:
#   $1 - Optional grep-compatible regex filter applied to repo names.
#        When omitted, all organization repositories are cached.
#
# Environment Variables:
#   GH_ORG    - GitHub organization name (required)
#   GH_USER   - GitHub username for HTTPS auth (required)
#   GH_TOKEN  - GitHub personal access token (required)
#
# Returns:
#   0 if all matching repos were cached/updated successfully
#   1 on fatal errors (missing env vars, failed to list repos, all repos failed)
#   2 if some repos failed while others succeeded (partial failure)
#
# Output:
#   Diagnostic messages on stderr. On success, outputs the cache directory path
#   on stdout.
#
# Examples:
#   # Cache everything
#   cache_dir=$(refresh_repo_cache)
#
#   # Cache only service repos
#   cache_dir=$(refresh_repo_cache "^service\.")
#
#   # Cache a single repo by exact name
#   cache_dir=$(refresh_repo_cache "^template\.service$")
#
refresh_repo_cache() {
    local filter="${1:-}"

    # Validate required environment
    if [ -z "${GH_ORG:-}" ]; then
        log_error "GH_ORG is not set. Cannot refresh repo cache."
        return 1
    fi
    if [ -z "${GH_USER:-}" ]; then
        log_error "GH_USER is not set. Cannot refresh repo cache."
        return 1
    fi
    if [ -z "${GH_TOKEN:-}" ]; then
        log_error "GH_TOKEN is not set. Cannot refresh repo cache."
        return 1
    fi

    # Fetch org repo list
    local all_repos
    all_repos=$(list_organization_repositories "$GH_ORG") || {
        log_error "Failed to list organization repositories"
        return 1
    }

    if [ -z "$all_repos" ]; then
        log_error "No repositories found in organization '$GH_ORG'"
        return 1
    fi

    # Apply filter if provided
    local repos="$all_repos"
    if [ -n "$filter" ]; then
        repos=$(echo "$all_repos" | grep -E "$filter") || true
        if [ -z "$repos" ]; then
            log_error "No repositories matched filter: $filter"
            return 1
        fi
    fi

    # Ensure cache directory exists
    local cache_dir="$REPO_CACHE_DIR"
    mkdir -p "$cache_dir" || {
        log_error "Failed to create cache directory: $cache_dir"
        return 1
    }

    local git_url_prefix="https://${GH_USER}:${GH_TOKEN}@github.com/${GH_ORG}"
    local count=0
    local repo_name

    # Count repos
    while IFS= read -r repo_name; do
        [ -z "$repo_name" ] && continue
        count=$((count + 1))
    done <<< "$repos"

    if [ "$count" -eq 0 ]; then
        log_error "No repositories to process"
        return 1
    fi

    log_info "Caching $count repositories ($REPO_CACHE_PARALLEL parallel)..."

    # Track failures via temp file (background jobs can't modify parent arrays)
    local fail_file
    fail_file=$(mktemp)

    local running=0
    while IFS= read -r repo_name; do
        [ -z "$repo_name" ] && continue
        local repo_dir="$cache_dir/$repo_name"
        local git_url="${git_url_prefix}/${repo_name}.git"

        # Throttle: wait for a slot when at max parallelism
        if [ "$running" -ge "$REPO_CACHE_PARALLEL" ]; then
            wait -n 2>/dev/null || true
            running=$((running - 1))
        fi

        # Launch in background; on failure, append repo name to fail_file
        (
            if [ -d "$repo_dir/.git" ]; then
                _update_cached_repo "$repo_dir" "$git_url" "$repo_name" \
                    || { echo "$repo_name" >> "$fail_file"; exit 1; }
            else
                _clone_cached_repo "$repo_dir" "$git_url" "$repo_name" \
                    || { echo "$repo_name" >> "$fail_file"; exit 1; }
            fi
        ) &
        running=$((running + 1))
    done <<< "$repos"

    # Wait for all remaining background jobs
    wait

    # Read failures
    local failed=()
    if [ -s "$fail_file" ]; then
        while IFS= read -r repo_name; do
            [ -n "$repo_name" ] && failed+=("$repo_name")
        done < "$fail_file"
    fi
    rm -f "$fail_file"

    if [ "${#failed[@]}" -eq "$count" ]; then
        log_error "All $count repositories failed to cache"
        return 1
    fi

    if [ "${#failed[@]}" -gt 0 ]; then
        log_warn "Failed to cache ${#failed[@]} of $count repositories: ${failed[*]}"
        _write_cache_timestamp "$cache_dir" "$repos"
        echo "$cache_dir"
        return 2
    fi

    # Write cache timestamp for staleness detection by downstream tools
    _write_cache_timestamp "$cache_dir" "$repos"

    log_info "Successfully cached $count repositories in $cache_dir"
    echo "$cache_dir"
    return 0
}

# ============================================================================
# Internal Helpers
# ============================================================================

# Clone a repository into the cache with minimal footprint
# Args:
#   $1 - target directory
#   $2 - git URL
#   $3 - repo name (for logging)
_clone_cached_repo() {
    local repo_dir="$1"
    local git_url="$2"
    local repo_name="$3"

    log_info "Cloning $repo_name into cache..."
    if ! git clone --depth 1 --single-branch --no-tags "$git_url" "$repo_dir" 2>/dev/null; then
        log_error "Failed to clone $repo_name"
        return 1
    fi
    return 0
}

# Update an existing cached repository to latest
# Args:
#   $1 - repo directory
#   $2 - git URL
#   $3 - repo name (for logging)
_update_cached_repo() {
    local repo_dir="$1"
    local git_url="$2"
    local repo_name="$3"

    log_info "Updating cached $repo_name..."

    if ! git -C "$repo_dir" fetch --depth 1 origin 2>/dev/null; then
        log_error "Failed to fetch updates for $repo_name"
        return 1
    fi

    if ! git -C "$repo_dir" reset --hard origin/HEAD 2>/dev/null; then
        log_error "Failed to reset $repo_name to latest"
        return 1
    fi

    # Prune stale objects to keep disk usage minimal
    git -C "$repo_dir" gc --prune=all --quiet 2>/dev/null || true

    return 0
}

# Write a timestamp marker after cache refresh
# Used by downstream tools (e.g. dependency index) for staleness detection.
# Args:
#   $1 - cache directory
#   $2 - newline-separated repo list that was cached
_write_cache_timestamp() {
    local cache_dir="$1"
    local repos="$2"
    local timestamp_file="$cache_dir/.cache_timestamp"
    local repo_hash
    repo_hash=$(echo "$repos" | sort | md5sum | cut -d' ' -f1)
    printf '%s\n%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$repo_hash" > "$timestamp_file"
}
