#!/bin/bash
# cs-dependencies-update-wizard.sh - Interactive wizard to update dependents after a package release
# Version: 1.1.0
# Description: Walks the reverse dependency tree of a target repo level by level,
#              updating each dependent repo's NuGet references, running tests,
#              creating PRs, and merging them. Pauses between depth levels so the
#              user can confirm GitHub Actions have completed.
#              With --global, processes ALL C# repos in topological order.
# Requirements: Bash 4.0+, git, gh CLI, jq, dotnet, dotnet-outdated
# Author: WorkInProgress.ai

# ============================================================================
# Configuration and Constants
# ============================================================================

readonly SCRIPT_VERSION="1.1.0"
# shellcheck disable=SC2155
readonly SCRIPT_NAME="$(basename "$0")"
readonly UPDATE_BRANCH="auto-update-references"
readonly SINGLE_REPO_WIZARD="$DEVENV_TOOLS/scripts/cs-references-update-wizard.sh"

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
Usage: $SCRIPT_NAME [OPTIONS] TARGET_DIR
       $SCRIPT_NAME [OPTIONS] --global [N]

Interactive wizard that updates C# NuGet dependencies across repositories.

SINGLE-TARGET MODE (default):
  Walks the reverse dependency tree of TARGET_DIR level by level, updating each
  dependent repo's NuGet references, creating PRs, and merging them.

  Arguments:
      TARGET_DIR      Path to the released library (must contain .sln or .csproj).
                      Defaults to the current directory.

GLOBAL MODE (--global):
  Computes a topological ordering of ALL C# repositories in the cache and
  updates them generation by generation — from foundational libraries up
  through services. Every repo gets cs-references-update run against it,
  including external package updates.

  Arguments:
      N               Optional starting generation (default: 0). Use this to
                      resume a previous run. Pass the generation number shown
                      in the output when you need to restart.

Options:
    -h, --help      Show this help message and exit
    -v, --version   Show version information and exit
    --global [N]    Global mode: update all C# repos in topological order,
                    optionally starting from generation N
    --no-refresh    Skip refreshing the repository cache
    --dry-run       Show what would be updated without making any changes

Workflow (single-target):
    For each depth level (0 = direct dependents, 1 = transitive, ...):
      1. Check if the repo already uses the latest version → skip if so
      2. Delegate to cs-references-update-wizard for the full update workflow
    After each depth level, wait for GitHub Actions to complete.

Workflow (--global):
    For each generation (0 = no org-internal deps, 1 = depends on gen-0, ...):
      1. Run cs-references-update-wizard for every repo in the generation
         (exit 10 = no changes → skip silently)
      2. If a repo fails, pause and ask the user to fix it before continuing
    After each generation, wait for GitHub Actions to complete.

Failure handling:
    If cs-references-update-wizard exits with a non-zero, non-10 code the
    wizard prompts to retry. Answering 'n' aborts the entire wizard because
    downstream repos may depend on the failing repo.

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

# Prompt the user for yes/no
# Usage: prompt_yes_no "question"
# Returns: 0 for yes, 1 for no
prompt_yes_no() {
    local question="$1"
    local answer
    echo ""
    while true; do
        read -r -p ">>> $question [y/n]: " answer < /dev/tty
        case "$answer" in
            [Yy]*) echo ""; return 0 ;;
            [Nn]*) echo ""; return 1 ;;
            *) echo "    Please answer y or n." ;;
        esac
    done
}

# Prompt retry / skip / abort
# Usage: prompt_retry_skip_abort "repo-name"
# Returns: 0 = retry, 1 = skip, 2 = abort
prompt_retry_skip_abort() {
    local repo="$1"
    local answer
    echo ""
    while true; do
        read -r -p ">>> $repo failed. [r]etry / [s]kip (continue without it) / [a]bort wizard: " answer < /dev/tty
        case "$answer" in
            [Rr]*) echo ""; return 0 ;;
            [Ss]*) echo ""; return 1 ;;
            [Aa]*) echo ""; return 2 ;;
            *) echo "    Please answer r, s, or a." ;;
        esac
    done
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
    local global_mode=0
    local global_start_gen=0

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
            --global)
                global_mode=1
                # Consume optional integer argument (starting generation)
                if [[ "${2:-}" =~ ^[0-9]+$ ]]; then
                    global_start_gen="$2"
                    shift
                fi
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

    # --global and TARGET_DIR are mutually exclusive
    if [ "$global_mode" -eq 1 ] && [ -n "$target_dir" ]; then
        die "--global and TARGET_DIR are mutually exclusive. Use --help for usage information." "$EXIT_INVALID_ARGUMENT"
    fi

    local root_repo=""

    # Single-target mode: validate TARGET_DIR
    if [ "$global_mode" -eq 0 ]; then
        target_dir="${target_dir:-.}"

        if [ ! -d "$target_dir" ]; then
            die "Directory not found: $target_dir" "$EXIT_INVALID_ARGUMENT"
        fi
        target_dir=$(cd "$target_dir" && pwd)

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

        root_repo=$(basename "$target_dir")
    fi

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

    # ── Step 2: Get generation/depth tree ─────────────────────────────────

    local tree_output
    if [ "$global_mode" -eq 1 ]; then
        log_info "Computing global topological generations..."
        tree_output=$(get_topological_generations)
    else
        tree_output=$(get_reverse_dependency_tree "$root_repo" \
            | awk -F'\t' '!seen[$2]++ { print $1 "\t" $2 }' \
            | sort -t$'\t' -k1,1n -k2)
    fi

    if [ -z "$tree_output" ]; then
        if [ "$global_mode" -eq 1 ]; then
            log_info "No C# repositories found in cache. Nothing to update."
        else
            log_info "No dependents found for $root_repo. Nothing to update."
        fi
        return 0
    fi

    local -a depths
    mapfile -t depths < <(echo "$tree_output" | awk -F'\t' '{ print $1 }' | sort -un)

    # Validate global_start_gen is within range
    if [ "$global_mode" -eq 1 ] && [ "$global_start_gen" -gt 0 ]; then
        local max_gen="${depths[-1]}"
        if [ "$global_start_gen" -gt "$max_gen" ]; then
            die "Starting generation $global_start_gen exceeds maximum generation $max_gen" "$EXIT_INVALID_ARGUMENT"
        fi
    fi

    # ── Step 3: Determine target packages (single-target mode only) ────────

    local -a target_packages=()
    declare -A latest_versions=()

    if [ "$global_mode" -eq 0 ]; then
        mapfile -t target_packages < <(list_repo_packages "$root_repo")

        if [ "${#target_packages[@]}" -eq 0 ]; then
            die "No packages found for repository $root_repo"
        fi

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
    fi

    # ── Header ─────────────────────────────────────────────────────────────

    echo ""
    echo "============================================================"
    if [ "$global_mode" -eq 1 ]; then
        if [ "$dry_run" -eq 1 ]; then
            echo "  Global Dependency Update Wizard (DRY RUN)"
        else
            echo "  Global Dependency Update Wizard"
        fi
        if [ "$global_start_gen" -gt 0 ]; then
            echo "  Resuming from generation: $global_start_gen"
        fi
    else
        if [ "$dry_run" -eq 1 ]; then
            echo "  Dependency Update Wizard (DRY RUN) for: $root_repo"
        else
            echo "  Dependency Update Wizard for: $root_repo"
        fi
    fi
    echo "  Generations to process: ${depths[*]}"
    echo "============================================================"

    # ── Step 4: Process each generation ───────────────────────────────────

    for depth in "${depths[@]}"; do

        # In global mode, skip generations before the requested start
        if [ "$global_mode" -eq 1 ] && [ "$depth" -lt "$global_start_gen" ]; then
            log_info "Skipping generation $depth (resuming from $global_start_gen)"
            continue
        fi

        echo ""
        echo "────────────────────────────────────────────────────────────"
        if [ "$global_mode" -eq 1 ]; then
            echo "  Processing generation $depth"
        else
            echo "  Processing depth $depth dependents"
        fi
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

            # Single-target mode: pre-flight version check
            if [ "$global_mode" -eq 0 ]; then
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
            fi

            # ── Dry-run: report and skip ──────────────────────────────────

            if [ "$dry_run" -eq 1 ]; then
                echo "  [DRY RUN] Would update $repo"
                if [ "$global_mode" -eq 0 ]; then
                    for pkg in "${target_packages[@]}"; do
                        local latest="${latest_versions[$pkg]:-}"
                        local used
                        used=$(get_used_version "$repo_dir" "$pkg")
                        if [ -n "$used" ] && [ -n "$latest" ] && [ "$used" != "$latest" ]; then
                            echo "    $pkg: $used → $latest"
                        fi
                    done
                fi
                processed=$((processed + 1))
                continue
            fi

            # ── Delegate per-repo workflow to cs-references-update-wizard ──

            local wizard_rc=0
            "$SINGLE_REPO_WIZARD" --branch "$UPDATE_BRANCH" "$repo_dir" || wizard_rc=$?

            if [ "$wizard_rc" -eq 10 ]; then
                # Exit 10 means nothing changed after running cs-references-update
                skipped=$((skipped + 1))
                continue
            elif [ "$wizard_rc" -ne 0 ]; then
                log_error "Single-repo wizard failed for $repo (exit $wizard_rc)"
                # Offer retry / skip / abort
                local skip_repo=0
                while true; do
                    local choice
                    prompt_retry_skip_abort "$repo"; choice=$?
                    if [ "$choice" -eq 2 ]; then
                        log_error "Aborting: $repo could not be updated and downstream repos may depend on it."
                        exit 1
                    elif [ "$choice" -eq 1 ]; then
                        log_warn "Skipping $repo — downstream repos may be affected."
                        skip_repo=1
                        break
                    fi
                    # choice 0 = retry
                    wizard_rc=0
                    "$SINGLE_REPO_WIZARD" --branch "$UPDATE_BRANCH" "$repo_dir" || wizard_rc=$?
                    if [ "$wizard_rc" -eq 0 ] || [ "$wizard_rc" -eq 10 ]; then
                        wizard_rc=0
                        break
                    fi
                    log_error "Retry failed for $repo (exit $wizard_rc)"
                done
                if [ "$skip_repo" -eq 1 ] || [ "$wizard_rc" -ne 0 ]; then
                    skipped=$((skipped + 1))
                    continue
                fi
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
        echo "  Generation $depth complete: $processed updated, $skipped skipped"

        # ── Between-generation: wait for GH Actions, refresh cache ────────

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
                log_info "Waiting for GitHub Actions to complete before processing generation $next_depth..."

                if [ "${#merged_repos[@]}" -gt 0 ]; then
                    if ! wait_for_workflow_runs_multi "master" 15 600 "${merged_repos[@]}"; then
                        log_warn "Some workflow runs failed or timed out."
                        prompt_user "Please verify GitHub Actions manually, then press Enter to continue."
                    fi
                fi

                # Refresh cache to pick up newly published package versions
                log_info "Refreshing repository cache for next generation..."
                refresh_repo_cache > /dev/null || {
                    local rc=$?
                    if [ "$rc" -eq 2 ]; then
                        log_warn "Some repositories failed to cache (continuing)"
                    else
                        log_warn "Cache refresh failed (continuing with existing cache)"
                    fi
                }

                log_info "Rebuilding dependency index..."
                build_dependency_index || log_warn "Index rebuild failed (continuing)"

                # Single-target only: refresh the latest published versions
                if [ "$global_mode" -eq 0 ]; then
                    for pkg in "${target_packages[@]}"; do
                        local ver
                        ver=$(get_latest_version "$pkg")
                        if [ -n "$ver" ]; then
                            latest_versions["$pkg"]="$ver"
                        fi
                    done
                fi
            fi
        fi
    done

    echo ""
    echo "============================================================"
    if [ "$global_mode" -eq 1 ]; then
        echo "  Global dependency update complete"
    else
        echo "  Dependency update wizard complete for: $root_repo"
    fi
    echo "============================================================"
}

# ============================================================================
# Script Entry Point
# ============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
