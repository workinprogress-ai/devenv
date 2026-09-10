#!/bin/bash
# repo-cache-deepen - Deepen cached repositories with history and branch refs
# Version: 1.0.0
# Description: Fetch-only deepening of the local repository cache. Extends the
#              shallow-clone depth and/or fetches additional branches as remote
#              refs (refs/remotes/origin/<branch>). Never checks out — cache
#              working copies stay on the default branch. Additive and
#              idempotent: re-running repo-cache-update does not undo deepening
#              (git fetch never truncates history it already has), though a
#              later `git gc --prune=all` during cache updates may drop
#              unreachable objects — deepened branches remain reachable via
#              their remote refs and survive.
# Requirements: Bash 4.3+, git
# Author: WorkInProgress.ai

# ============================================================================
# Configuration and Constants
# ============================================================================

readonly SCRIPT_VERSION="1.0.0"
# shellcheck disable=SC2155
readonly SCRIPT_NAME="$(basename "$0")"

DEFAULT_DEPTH=200

# ============================================================================
# Source Required Libraries
# ============================================================================

# shellcheck source=../lib/error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"

# shellcheck source=../lib/repo-cache.bash
source "$DEVENV_TOOLS/lib/repo-cache.bash"

enable_strict_mode

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME --repo <name> [--depth N] [--branch <b>]...

Fetch-only deepening of a cached repository. Extends shallow-clone history
and/or fetches additional branches as remote refs. The working copy is never
checked out — it stays on the default branch; branches land as
refs/remotes/origin/<branch>.

Options:
    --repo <name>       Repository name in the cache (required)
    --depth N           Deepen history to N commits per branch (default: $DEFAULT_DEPTH)
    --branch <b>        Fetch branch <b> as a remote ref (repeatable)
    -h, --help          Show this help message and exit
    -v, --version       Show version information and exit

Exit Codes:
    0   Success
    1   Error (unknown repo, missing arguments, fetch failure)

Examples:
    # Deepen one repo's history to the default depth
    $SCRIPT_NAME --repo lib.cs.services.bulk-sync

    # Deepen to 500 commits and fetch two feature branches
    $SCRIPT_NAME --repo service.reqord.identity --depth 500 \\
        --branch issue-42-query-progress --branch issue-57-audit

EOF
    exit 0
}

# ============================================================================
# Main Function
# ============================================================================

main() {
    local repo=""
    local depth="$DEFAULT_DEPTH"
    local branches=()

    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                ;;
            -v|--version)
                echo "$SCRIPT_NAME version $SCRIPT_VERSION"
                exit 0
                ;;
            --repo)
                [ $# -ge 2 ] || die "--repo requires a value" "$EXIT_INVALID_ARGUMENT"
                repo="$2"
                shift 2
                ;;
            --repo=*)
                repo="${1#--repo=}"
                shift
                ;;
            --depth)
                [ $# -ge 2 ] || die "--depth requires a value" "$EXIT_INVALID_ARGUMENT"
                depth="$2"
                shift 2
                ;;
            --depth=*)
                depth="${1#--depth=}"
                shift
                ;;
            --branch)
                [ $# -ge 2 ] || die "--branch requires a value" "$EXIT_INVALID_ARGUMENT"
                branches+=("$2")
                shift 2
                ;;
            --branch=*)
                branches+=("${1#--branch=}")
                shift
                ;;
            *)
                die "Unknown argument: $1. Use --help for usage information." "$EXIT_INVALID_ARGUMENT"
                ;;
        esac
    done

    [ -n "$repo" ] || die "--repo is required" "$EXIT_INVALID_ARGUMENT"
    [[ "$depth" =~ ^[0-9]+$ ]] || die "--depth must be a positive integer, got: $depth" "$EXIT_INVALID_ARGUMENT"

    local repo_dir="$REPO_CACHE_DIR/$repo"
    if [ ! -d "$repo_dir/.git" ]; then
        die "Repository '$repo' not found in cache ($REPO_CACHE_DIR). Run repo-cache-update first." "$EXIT_GENERAL_ERROR"
    fi

    # Step 1: Deepen history (fetch-only; never checks out)
    log_info "Deepening $repo history to depth $depth..."
    if ! git -C "$repo_dir" fetch --deepen="$depth" origin 2>/dev/null; then
        die "Failed to deepen history for $repo" "$EXIT_GENERAL_ERROR"
    fi

    # Step 2: Fetch requested branches as remote refs (never checks out)
    local branch
    for branch in "${branches[@]}"; do
        [ -n "$branch" ] || continue
        log_info "Fetching branch $branch of $repo as a remote ref..."
        if ! git -C "$repo_dir" fetch origin "+${branch}:refs/remotes/origin/${branch}" 2>/dev/null; then
            die "Failed to fetch branch '$branch' for $repo" "$EXIT_GENERAL_ERROR"
        fi
    done

    log_info "Deepened $repo in $repo_dir (working copy untouched)"
}

# ============================================================================
# Script Entry Point
# ============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
