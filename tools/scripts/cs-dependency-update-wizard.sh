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
      2. Create branch '$UPDATE_BRANCH'
      3. Run cs-update-references to update all NuGet packages
      4. Detect major version bumps in non-test code (breaking changes)
      5. Run tests — pause for user if they fail
      6. Confirm change level with user if breaking changes detected
      7. Create and merge PR (patch: or major: prefix)
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
            [Yy]*) return 0 ;;
            [Nn]*) return 1 ;;
            *) echo "    Please answer y or n." ;;
        esac
    done
}

# Snapshot PackageReference versions from non-test csproj files
# Usage: snapshot_versions REPO_DIR
# Output: sorted lines of "PACKAGE_NAME VERSION" from src/ csprojs
snapshot_versions() {
    local repo_dir="$1"
    find "$repo_dir" -path "*/src/*.csproj" \
        ! -path "*/test/*" ! -path "*/tests/*" \
        -exec grep -ohP 'PackageReference Include="[^"]+" Version="[^"]+"' {} \; 2>/dev/null \
        | sed -E 's/PackageReference Include="([^"]+)" Version="([^"]+)"/\1 \2/' \
        | sort -u
}

# Compare two version snapshots and detect major version bumps
# Usage: detect_major_bumps BEFORE_FILE AFTER_FILE
# Returns: 0 if major bumps found, 1 if none
# Output: lines describing the major bumps
detect_major_bumps() {
    local before_file="$1"
    local after_file="$2"
    local found_major=1

    while IFS=' ' read -r pkg new_ver; do
        local old_ver
        old_ver=$(awk -v p="$pkg" '$1 == p { print $2 }' "$before_file")
        [ -z "$old_ver" ] && continue

        local old_major="${old_ver%%.*}"
        local new_major="${new_ver%%.*}"

        if [ "$new_major" != "$old_major" ] && [ "$new_major" -gt "$old_major" ] 2>/dev/null; then
            echo "  $pkg: $old_ver → $new_ver (MAJOR)"
            found_major=0
        fi
    done < "$after_file"

    return "$found_major"
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

            # ── 4a: Create update branch ──────────────────────────────────

            log_info "Creating branch $UPDATE_BRANCH..."
            git -C "$repo_dir" checkout -b "$UPDATE_BRANCH" 2>/dev/null || {
                # Branch may already exist from a previous aborted run
                git -C "$repo_dir" checkout master 2>/dev/null
                git -C "$repo_dir" branch -D "$UPDATE_BRANCH" 2>/dev/null || true
                git -C "$repo_dir" checkout -b "$UPDATE_BRANCH" 2>/dev/null || {
                    log_error "Failed to create branch in $repo — skipping"
                    continue
                }
            }

            # ── 4b: Snapshot versions before update ───────────────────────

            local before_file after_file
            before_file=$(mktemp)
            after_file=$(mktemp)
            snapshot_versions "$repo_dir" > "$before_file"

            # ── 4c: Run dependency update ─────────────────────────────────

            log_info "Updating NuGet references..."
            if ! cs-update-references "$repo_dir" 2>&1; then
                log_warn "cs-update-references reported issues (continuing)"
            fi

            # ── 4d: Detect breaking changes via version diff ──────────────

            snapshot_versions "$repo_dir" > "$after_file"

            local has_breaking=0
            local major_bumps
            major_bumps=$(detect_major_bumps "$before_file" "$after_file" 2>&1) && has_breaking=1
            rm -f "$before_file" "$after_file"

            if [ "$has_breaking" -eq 1 ]; then
                log_warn "Major version bumps detected in non-test code:"
                echo "$major_bumps"
            fi

            # Check if anything actually changed
            if git -C "$repo_dir" diff --quiet; then
                log_info "No changes after update — skipping"
                git -C "$repo_dir" checkout master 2>/dev/null
                git -C "$repo_dir" branch -D "$UPDATE_BRANCH" 2>/dev/null || true
                skipped=$((skipped + 1))
                continue
            fi

            # ── 4e: Commit and push ───────────────────────────────────────

            git -C "$repo_dir" add -A
            git -C "$repo_dir" commit -m "chore: update dependencies" --quiet

            log_info "Pushing branch..."
            if ! git -C "$repo_dir" push -u origin "$UPDATE_BRANCH" --quiet 2>/dev/null; then
                # Force push in case branch exists on remote from previous aborted run
                git -C "$repo_dir" push -u origin "$UPDATE_BRANCH" --force --quiet 2>/dev/null || {
                    log_error "Failed to push branch for $repo — skipping"
                    git -C "$repo_dir" checkout master 2>/dev/null
                    git -C "$repo_dir" branch -D "$UPDATE_BRANCH" 2>/dev/null || true
                    continue
                }
            fi

            # ── 4f: Run tests ─────────────────────────────────────────────

            local tests_failed=0
            if [ -x "$repo_dir/run-tests" ]; then
                log_info "Running tests..."
                if ! (cd "$repo_dir" && ./run-tests) 2>&1; then
                    tests_failed=1
                    log_warn "Tests FAILED for $repo"
                    prompt_user "Please fix the failing tests in $repo_dir, then press Enter to continue."

                    # Re-commit any fixes the user made
                    if ! git -C "$repo_dir" diff --quiet; then
                        git -C "$repo_dir" add -A
                        git -C "$repo_dir" commit -m "chore: fix tests after dependency update" --quiet
                        git -C "$repo_dir" push --quiet 2>/dev/null
                    fi
                else
                    log_info "Tests passed"
                fi
            else
                log_warn "No run-tests script found in $repo — skipping tests"
            fi

            # ── 4g: Determine change level ────────────────────────────────

            local change_level="patch"
            if [ "$has_breaking" -eq 1 ] || [ "$tests_failed" -eq 1 ]; then
                log_warn "Breaking changes were detected (major version bumps and/or test failures)."
                if prompt_yes_no "Treat this as a MAJOR (breaking) change? (No = patch)"; then
                    change_level="major"
                fi
            fi

            local pr_title="${change_level}: update dependencies"

            # ── 4h: Create PR ─────────────────────────────────────────────

            log_info "Creating PR: '$pr_title'..."
            local pr_url
            pr_url=$(pr-create-for-merge --no-issue --repo-dir "$repo_dir" --branch "$UPDATE_BRANCH" "$pr_title" 2>&1 | grep -oE 'https://github.com[^ ]+' | head -1) || true

            if [ -z "$pr_url" ]; then
                log_error "Failed to create PR for $repo"
                prompt_user "Please resolve the issue manually, then press Enter to continue."
            else
                log_info "PR created: $pr_url"

                # ── 4i: Merge PR ──────────────────────────────────────────

                # Brief delay for GitHub API consistency
                sleep 3
                log_info "Merging PR..."
                if ! pr-merge-pull-request "$pr_title" --repo-dir "$repo_dir" --branch "$UPDATE_BRANCH" --force 2>&1; then
                    log_error "Failed to merge PR for $repo"
                    prompt_user "Please merge manually, then press Enter to continue."
                else
                    log_info "PR merged successfully"
                fi
            fi

            # ── 4j: Return to master ──────────────────────────────────────

            sleep 3
            git -C "$repo_dir" checkout master 2>/dev/null
            git -C "$repo_dir" pull --quiet 2>/dev/null || true
            git -C "$repo_dir" branch -D "$UPDATE_BRANCH" 2>/dev/null || true

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
                prompt_user "Depth $depth repos have been merged. Please confirm all GitHub Actions have completed before processing depth $next_depth dependents."

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
