#!/bin/bash
# cs-dependencies-trace.sh - Trace reverse dependencies for a C# repository
# Version: 1.0.0
# Description: Refreshes the repository cache, builds the dependency index,
#              and outputs a flat TSV listing of all repositories that depend
#              on the target (directly or transitively).
# Requirements: Bash 4.0+, git, gh CLI, grep, awk
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
Usage: $SCRIPT_NAME [OPTIONS] [TARGET_DIR]

Trace reverse dependencies for a C# repository. Outputs a flat list of all
dependencies on the target, directly or transitively.

The target directory must contain a .sln file and/or .csproj file(s).

Default output format:
    DEPTH:REPO:PACKAGE   e.g. 0:lib.cs.services.sagas:WorkInProgress.Lib.Services.Sagas.Common

With --by-repo:
    DEPTH:REPO           e.g. 0:lib.cs.services.chassis

DEPTH is the distance from root (0 = direct, 1 = transitive, ...).
REPO is the repository that depends on the target.
PACKAGE is a package produced by that repository.

Arguments:
    TARGET_DIR      Path to directory containing .sln or .csproj files.
                    Defaults to the current directory.

Options:
    -h, --help      Show this help message and exit
    -v, --version   Show version information and exit
    --by-repo       Group output by repository name instead of package
    --no-refresh    Skip refreshing the repository cache (use existing cache)

Examples:
    # Trace dependents of the current project
    $SCRIPT_NAME

    # Trace dependents of a specific library
    $SCRIPT_NAME repos/lib.cs.common.essentials

    # Quick trace using existing cache
    $SCRIPT_NAME --no-refresh repos/lib.cs.services.chassis

    # Filter to direct dependents only
    $SCRIPT_NAME --no-refresh repos/lib.cs.common.essentials | grep '^0:'

    # Show dependent repos instead of packages
    $SCRIPT_NAME --by-repo --no-refresh repos/lib.cs.common.essentials

    # List unique dependent repos
    $SCRIPT_NAME --by-repo --no-refresh repos/lib.cs.common.essentials | cut -d: -f2 | sort -u

Exit Codes:
    0   Success
    1   General error
    3   Invalid arguments (no .sln or .csproj found)

EOF
    exit 0
}

# ============================================================================
# Main Function
# ============================================================================

main() {
    local target_dir=""
    local skip_refresh=0
    local by_repo=0

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
            --by-repo)
                by_repo=1
                shift
                ;;
            -*)
                die "Unknown option: $1. Use --help for usage information." "$EXIT_INVALID_ARGUMENT"
                ;;
            *)
                if [ -z "$target_dir" ]; then
                    target_dir="$1"
                else
                    die "Too many arguments. Use --help for usage information." "$EXIT_INVALID_ARGUMENT"
                fi
                shift
                ;;
        esac
    done

    target_dir="${target_dir:-.}"

    if [ ! -d "$target_dir" ]; then
        die "Directory not found: $target_dir" "$EXIT_INVALID_ARGUMENT"
    fi
    target_dir=$(cd "$target_dir" && pwd)

    # Validate: must have .sln or .csproj
    local has_sln=0
    if compgen -G "$target_dir/*.sln" > /dev/null 2>&1; then
        has_sln=1
    fi

    local csproj_files
    csproj_files=$(find "$target_dir" -name "*.csproj" \
        ! -path "*/test/*" ! -path "*/tests/*" 2>/dev/null)

    if [ -z "$csproj_files" ] && [ "$has_sln" -eq 0 ]; then
        die "No .sln or .csproj files found in: $target_dir" "$EXIT_INVALID_ARGUMENT"
    fi

    local repo_name
    repo_name=$(basename "$target_dir")

    # Step 1: Refresh repo cache
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

    # Step 2: Ensure dependency index is current
    log_info "Building dependency index..."
    ensure_dependency_index || die "Failed to build dependency index"

    # Step 3: Output dependency trace (deduplicated, sorted by depth)
    if [ "$by_repo" -eq 1 ]; then
        get_reverse_dependency_tree "$repo_name" | awk -F'\t' '{ print $1 ":" $2 }' | sort -t: -k1,1n -k2 -u
    else
        get_reverse_dependency_tree "$repo_name" \
            | awk -F'\t' '!seen[$1,$2]++ { print $1 "\t" $2 }' \
            | awk -F'\t' '
                NR==FNR { pkgs[$1] = pkgs[$1] ? pkgs[$1] SUBSEP $2 : $2; next }
                {
                    n = split(pkgs[$2], arr, SUBSEP)
                    for (i = 1; i <= n; i++) print $1 ":" $2 ":" arr[i]
                }
            ' "$CS_DEP_INDEX_DIR/repo_packages.tsv" - \
            | sort -t: -k1,1n -k2 -k3 -u
    fi
}

# ============================================================================
# Script Entry Point
# ============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
