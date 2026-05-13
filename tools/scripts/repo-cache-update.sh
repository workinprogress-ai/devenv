#!/bin/bash
# repo-cache-update - Refresh the C# repository cache and dependency index
# Version: 1.0.0
# Description: Clones or updates all organization C# repositories into the local
#              cache and rebuilds the dependency index. Prints the cache directory
#              path on stdout so callers can use it directly.
# Requirements: Bash 4.0+, git, gh CLI
# Author: WorkInProgress.ai

# ============================================================================
# Configuration and Constants
# ============================================================================

readonly SCRIPT_VERSION="1.0.0"
# shellcheck disable=SC2155
readonly SCRIPT_NAME="$(basename "$0")"

# ============================================================================
# Source Required Libraries
# ============================================================================

# shellcheck source=../lib/error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"

enable_strict_mode

# shellcheck source=../lib/repo-cache.bash
source "$DEVENV_TOOLS/lib/repo-cache.bash"

# shellcheck source=../lib/cs-dependency-graph.bash
source "$DEVENV_TOOLS/lib/cs-dependency-graph.bash"

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

Refresh the C# repository cache and dependency index, then print the cache
directory path on stdout.

All organization repositories are cloned (or updated) as shallow single-branch
clones. The dependency index is rebuilt whenever the cache has changed.

Options:
    -h, --help          Show this help message and exit
    -v, --version       Show version information and exit
    --no-refresh        Skip refreshing the repository cache (rebuild index only)

Exit Codes:
    0   Success — cache directory path printed on stdout
    1   General error
    2   Partial cache failure (some repos failed, index still built)

EOF
    exit 0
}

# ============================================================================
# Main Function
# ============================================================================

main() {
    local skip_refresh=0

    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                ;;
            -v|--version)
                echo "$SCRIPT_NAME version $SCRIPT_VERSION"
                exit 0
                ;;
            --no-refresh)
                skip_refresh=1
                shift
                ;;
            -*)
                die "Unknown option: $1. Use --help for usage information." "$EXIT_INVALID_ARGUMENT"
                ;;
            *)
                die "Unexpected argument: $1. Use --help for usage information." "$EXIT_INVALID_ARGUMENT"
                ;;
        esac
    done

    # Step 1: Refresh the repo cache (clone / update all org repos)
    if [ "$skip_refresh" -eq 0 ]; then
        log_info "Refreshing repository cache..."
        refresh_repo_cache > /dev/null || {
            local rc=$?
            if [ "$rc" -eq 2 ]; then
                log_warn "Some repositories failed to cache (continuing with partial cache)"
            else
                die "Failed to refresh repository cache"
            fi
        }
    fi

    # Step 2: Ensure the dependency index is current
    log_info "Building dependency index..."
    ensure_dependency_index || die "Failed to build dependency index"

    # Step 3: Print the cache directory path
    echo "$REPO_CACHE_DIR"
}

# ============================================================================
# Script Entry Point
# ============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
