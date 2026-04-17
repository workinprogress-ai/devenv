#!/bin/bash
# cs-dependency-update-wizard.sh - Interactive wizard to update dependents after a package release
# Version: 1.0.0
# Description: Walks the reverse dependency tree of a target repo level by level,
#              updating each dependent repo's NuGet references, running tests,
#              creating PRs, and merging them. Pauses between depth levels so the
#              user can confirm GitHub Actions have completed.
# Requirements: Bash 4.0+, git, gh CLI, jq, dotnet, dotnet-outdated
# Author: WorkInProgress.ai

# ============================================================================
# Configuration and Constants
# ============================================================================

readonly SCRIPT_VERSION="1.0.0"
# shellcheck disable=SC2155
readonly SCRIPT_NAME="$(basename "$0")"
readonly UPDATE_BRANCH="auto-update-dependencies"
readonly SINGLE_REPO_WIZARD="$DEVENV_TOOLS/scripts/cs-update-single-repo-wizard.sh"

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

# shellcheck source=../lib/github-helpers.bash
source "$DEVENV_TOOLS/lib/github-helpers.bash"

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS] [TARGET_DIR]

Interactive wizard that walks the reverse dependency tree of a C# repository
and updates each dependent repo's NuGet references, runs tests, creates PRs,
and merges them — level by level.

The target directory must contain a .sln file and/or .csproj file(s).

Arguments:
    TARGET_DIR      Path to directory containing .sln or .csproj files.
                    Defaults to the current directory.

Options:
    -h, --help      Show this help message and exit
    -v, --version   Show version information and exit
    --no-refresh    Skip refreshing the repository cache
    --dry-run       Show what would be updated without making any changes

Workflow:
    For each depth level (0 = direct dependents, 1 = transitive, ...):
      1. Check if the repo already uses the latest version → skip if so
      2. Delegate to cs-update-single-repo-wizard for the full update workflow:
         a. Create branch '$UPDATE_BRANCH'
         b. Run cs-update-references to update all NuGet packages
         c. Detect major version bumps in non-test code (breaking changes)
         d. Run tests — pause for user if they fail
         e. Confirm change level with user if breaking changes detected
         f. Create and merge PR (patch: or major: prefix)
    After each depth level, pause for user to confirm GH Actions completed.

EOF
    exit 0
}

# Prompt the user and wait for confirmation
# Usage: prompt_user "message"
# Returns when user presses Enter
prompt_user() {
    local message="$1"
    echo ""
    echo ">>> $message"
    read -r -p "    Press Enter to continue (or Ctrl+C to abort)... " < /dev/tty
    echo ""
}

# Get the latest published version of a package
# Usage: get_latest_version PACKAGE_NAME
# Output: version string (e.g., "3.0.0")
get_latest_version() {
    local pkg_name="$1"
    artifacts-list --type nuget --versions --name "$pkg_name" --format json 2>/dev/null \
        | jq -r 'sort_by(.created_at) | reverse | .[0].name // empty'
}

# Get the version of a specific package used in a repo's non-test csprojs
# Usage: get_used_version REPO_DIR PACKAGE_NAME
# Output: version string, or empty if not found
get_used_version() {
    local repo_dir="$1"
    local pkg_name="$2"
    find "$repo_dir" -path "*/src/*.csproj" \
        ! -path "*/test/*" ! -path "*/tests/*" \
        -exec grep -ohP "PackageReference Include=\"${pkg_name}\" Version=\"[^\"]+\"" {} \; 2>/dev/null \
        | head -1 \
        | sed -E 's/.*Version="([^"]+)".*/\1/'
}

# ============================================================================
# Main Function
# ============================================================================

main() {
    local target_dir=""
    local skip_refresh=0
    local dry_run=0

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
            --dry-run)
                dry_run=1
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

    local root_repo
    root_repo=$(basename "$target_dir")

    # ── Step 1: Refresh cache and build index ──────────────────────────────

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

    log_info "Building dependency index..."
    ensure_dependency_index || die "Failed to build dependency index"

    # ── Step 2: Get reverse dependency tree (by-repo, deduplicated) ────────

    local tree_output
    tree_output=$(get_reverse_dependency_tree "$root_repo" \
        | awk -F'\t' '!seen[$2]++ { print $1 "\t" $2 }' \
        | sort -t$'\t' -k1,1n -k2)

    if [ -z "$tree_output" ]; then
        log_info "No dependents found for $root_repo. Nothing to update."
        return 0
    fi

    # Collect unique depth levels
    local -a depths
    mapfile -t depths < <(echo "$tree_output" | awk -F'\t' '{ print $1 }' | sort -un)

    # ── Step 3: Determine target packages and their latest versions ────────

    local -a target_packages
    mapfile -t target_packages < <(list_repo_packages "$root_repo")

    if [ "${#target_packages[@]}" -eq 0 ]; then
        die "No packages found for repository $root_repo"
    fi

    # Get latest version for each target package
    declare -A latest_versions
    for pkg in "${target_packages[@]}"; do
        local ver
        ver=$(get_latest_version "$pkg")
        if [ -z "$ver" ]; then
            log_warn "Could not determine latest version for $pkg — will skip version check"
        else
            latest_versions["$pkg"]="$ver"
            log_info "Latest version of $pkg: $ver"
        fi
    done

    echo ""
    echo "============================================================"
    if [ "$dry_run" -eq 1 ]; then
    echo "  Dependency Update Wizard (DRY RUN) for: $root_repo"
    else
    echo "  Dependency Update Wizard for: $root_repo"
    fi
    echo "  Depth levels to process: ${depths[*]}"
    echo "============================================================"

    # ── Step 4: Process each depth level ───────────────────────────────────

    for depth in "${depths[@]}"; do
        echo ""
        echo "────────────────────────────────────────────────────────────"
        echo "  Processing depth $depth dependents"
        echo "────────────────────────────────────────────────────────────"

        local -a repos_at_depth
        mapfile -t repos_at_depth < <(echo "$tree_output" | awk -F'\t' -v d="$depth" '$1 == d { print $2 }')

        local processed=0
        local skipped=0
        local -a merged_repos=()

        for repo in "${repos_at_depth[@]}"; do
            local repo_dir="$REPO_CACHE_DIR/$repo"

            if [ ! -d "$repo_dir" ]; then
                log_warn "Cached repo not found: $repo — skipping"
                continue
            fi

            echo ""
            log_info "── $repo ──"

            # Check if already on latest version for all target packages
            local needs_update=0
            for pkg in "${target_packages[@]}"; do
                local latest="${latest_versions[$pkg]:-}"
                [ -z "$latest" ] && { needs_update=1; break; }

                local used
                used=$(get_used_version "$repo_dir" "$pkg")
                if [ -n "$used" ] && [ "$used" != "$latest" ]; then
                    log_info "$pkg: using $used, latest is $latest"
                    needs_update=1
                    break
                fi
            done

            if [ "$needs_update" -eq 0 ]; then
                log_info "Already up to date — skipping"
                skipped=$((skipped + 1))
                continue
            fi

            # ── Dry-run: report and skip ──────────────────────────────────

            if [ "$dry_run" -eq 1 ]; then
                echo "  [DRY RUN] Would update $repo"
                for pkg in "${target_packages[@]}"; do
                    local latest="${latest_versions[$pkg]:-}"
                    local used
                    used=$(get_used_version "$repo_dir" "$pkg")
                    if [ -n "$used" ] && [ -n "$latest" ] && [ "$used" != "$latest" ]; then
                        echo "    $pkg: $used → $latest"
                    fi
                done
                processed=$((processed + 1))
                continue
            fi

            # ── Delegate per-repo workflow to cs-update-single-repo-wizard ──

            local wizard_rc=0
            "$SINGLE_REPO_WIZARD" --branch "$UPDATE_BRANCH" "$repo_dir" || wizard_rc=$?

            if [ "$wizard_rc" -eq 10 ]; then
                # Exit 10 means the repo was a no-op after updating references
                skipped=$((skipped + 1))
                continue
            elif [ "$wizard_rc" -ne 0 ]; then
                log_error "Single-repo wizard failed for $repo (exit $wizard_rc) — skipping"
                continue
            fi

            # Track the full repo name for workflow monitoring
            local full_name
            full_name=$(get_full_repo_name "$repo_dir" 2>/dev/null) || true
            if [ -n "$full_name" ]; then
                merged_repos+=("$full_name")
            fi

            processed=$((processed + 1))
        done

        echo ""
        echo "  Depth $depth complete: $processed updated, $skipped skipped"

        # Check if there are more depth levels
        local current_idx
        for i in "${!depths[@]}"; do
            if [ "${depths[$i]}" = "$depth" ]; then
                current_idx=$i
                break
            fi
        done

        if [ "$current_idx" -lt $(( ${#depths[@]} - 1 )) ]; then
            local next_depth="${depths[$((current_idx + 1))]}"

            if [ "$processed" -gt 0 ]; then
                log_info "Waiting for GitHub Actions to complete for depth $depth repos before processing depth $next_depth..."

                if [ "${#merged_repos[@]}" -gt 0 ]; then
                    if ! wait_for_workflow_runs_multi "master" 15 600 "${merged_repos[@]}"; then
                        log_warn "Some workflow runs failed or timed out."
                        prompt_user "Please verify GitHub Actions manually, then press Enter to continue."
                    fi
                fi

                # Refresh the cache to pick up newly published package versions
                log_info "Refreshing repository cache for next depth level..."
                refresh_repo_cache > /dev/null || {
                    local rc=$?
                    if [ "$rc" -eq 2 ]; then
                        log_warn "Some repositories failed to cache (continuing)"
                    else
                        log_warn "Cache refresh failed (continuing with existing cache)"
                    fi
                }

                # Rebuild index with updated cache
                log_info "Rebuilding dependency index..."
                build_dependency_index || log_warn "Index rebuild failed (continuing)"

                # Update latest versions since GH Actions may have published new packages
                for pkg in "${target_packages[@]}"; do
                    local ver
                    ver=$(get_latest_version "$pkg")
                    if [ -n "$ver" ]; then
                        latest_versions["$pkg"]="$ver"
                    fi
                done
            fi
        fi
    done

    echo ""
    echo "============================================================"
    echo "  Dependency update wizard complete for: $root_repo"
    echo "============================================================"
}

# ============================================================================
# Script Entry Point
# ============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
