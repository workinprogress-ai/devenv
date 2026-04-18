#!/bin/bash
# cs-references-update-wizard.sh - Update NuGet dependencies in a single repository
# Version: 1.0.0
# Description: Runs the full dependency-update workflow for one repository:
#              creates a branch, runs cs-references-update, detects major version
#              bumps, runs tests, prompts on failures or breaking changes, and
#              creates + merges a PR.
# Requirements: Bash 4.0+, git, gh CLI, jq, dotnet, dotnet-outdated
# Author: WorkInProgress.ai

# ============================================================================
# Configuration and Constants
# ============================================================================

readonly SCRIPT_VERSION="1.0.0"
# shellcheck disable=SC2155
readonly SCRIPT_NAME="$(basename "$0")"
readonly DEFAULT_UPDATE_BRANCH="auto-update-references"

# Script-specific exit codes (>= 10 to avoid conflicts with error-handling.bash globals)
# shellcheck disable=SC2034
readonly EXIT_NO_CHANGES=10      # No-op: nothing changed after cs-references-update
# shellcheck disable=SC2034
readonly EXIT_GIT_FAILED=20      # git operation failed (branch, commit, or push)
# shellcheck disable=SC2034
readonly EXIT_UPDATE_FAILED=21   # cs-references-update failed
# shellcheck disable=SC2034
readonly EXIT_TESTS_FAILED=30    # Tests still failing after user had a chance to fix
# shellcheck disable=SC2034
readonly EXIT_PR_FAILED=40       # PR could not be created
# shellcheck disable=SC2034
readonly EXIT_MERGE_FAILED=41    # PR could not be merged

# ============================================================================
# Source Required Libraries
# ============================================================================

# shellcheck source=../lib/error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"

enable_strict_mode

# shellcheck source=../lib/github-helpers.bash
source "$DEVENV_TOOLS/lib/github-helpers.bash"

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS] REPO_DIR

Runs the full NuGet dependency-update workflow for a single repository:
  1. Create branch '$DEFAULT_UPDATE_BRANCH' (or the value of --branch)
  2. Run cs-references-update to update all NuGet packages
  3. Detect major version bumps in non-test code (breaking changes)
  4. Run tests — pause for user if they fail
  5. Determine change level (patch: or major:)
  6. Commit and push
  7. Create and merge PR

Arguments:
    REPO_DIR        Path to the repository directory to update.
                    Defaults to the current directory.

Options:
    -h, --help          Show this help message and exit
    -v, --version       Show version information and exit
    --branch NAME       Branch name to create (default: $DEFAULT_UPDATE_BRANCH)
    --dry-run           Show what would happen without making any changes
    --continue          Resume a previously started update. Expects the update
                        branch to exist with staged or unstaged changes. Skips
                        branch creation and dependency update steps.

Exit codes:
    0    Repo was updated (PR created and merged)
    10   No-op: nothing changed after running cs-references-update
    20   git operation failed (branch creation, commit, or push)
    21   cs-references-update failed
    30   Tests still failing after user had a chance to fix
    40   PR could not be created
    41   PR could not be merged
    1–5  Argument / environment error (from error-handling.bash)

EOF
    exit 0
}

# Prompt the user and wait for confirmation
# Usage: prompt_user "message"
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

# ============================================================================
# Main Function
# ============================================================================

main() {
    local repo_dir=""
    local update_branch="$DEFAULT_UPDATE_BRANCH"
    local dry_run=0
    local continue_mode=0

    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                ;;
            -v|--version)
                echo "$SCRIPT_NAME version $SCRIPT_VERSION"
                exit 0
                ;;
            --branch)
                update_branch="$2"
                shift 2
                ;;
            --dry-run)
                dry_run=1
                shift
                ;;
            --continue)
                continue_mode=1
                shift
                ;;
            -*)
                die "Unknown option: $1. Use --help for usage information." "$EXIT_INVALID_ARGUMENT"
                ;;
            *)
                if [ -z "$repo_dir" ]; then
                    repo_dir="$1"
                else
                    die "Too many arguments. Use --help for usage information." "$EXIT_INVALID_ARGUMENT"
                fi
                shift
                ;;
        esac
    done

    repo_dir="${repo_dir:-.}"

    if [ ! -d "$repo_dir" ]; then
        die "Directory not found: $repo_dir" "$EXIT_INVALID_ARGUMENT"
    fi
    repo_dir=$(cd "$repo_dir" && pwd)

    local repo_name
    repo_name=$(basename "$repo_dir")

    # ── Dry-run: report and exit ───────────────────────────────────────────

    if [ "$dry_run" -eq 1 ]; then
        echo "  [DRY RUN] Would update $repo_name (branch: $update_branch)"
        return 0
    fi

    local has_breaking=0

    if [ "$continue_mode" -eq 1 ]; then
        # ── Continue mode: verify branch and changes ──────────────────────

        log_info "Continuing previous update in $repo_name..."
        local current_branch
        current_branch=$(git -C "$repo_dir" rev-parse --abbrev-ref HEAD 2>/dev/null)

        if [ "$current_branch" != "$update_branch" ]; then
            if ! git -C "$repo_dir" checkout "$update_branch" 2>/dev/null; then
                log_error "Branch '$update_branch' not found in $repo_name. Nothing to continue."
                exit $EXIT_GIT_FAILED
            fi
        fi

        if git -C "$repo_dir" diff --quiet && git -C "$repo_dir" diff --cached --quiet; then
            log_info "No staged or unstaged changes on branch '$update_branch' — nothing to continue."
            exit $EXIT_NO_CHANGES
        fi

        log_info "Found changes on branch '$update_branch' — resuming workflow"
    else
        # ── Step 1: Ensure master is up to date ───────────────────────────

        log_info "Syncing master to origin in $repo_name..."
        git -C "$repo_dir" checkout master 2>/dev/null || {
            log_error "Failed to checkout master in $repo_name"
            exit $EXIT_GIT_FAILED
        }
        git -C "$repo_dir" fetch origin master --quiet 2>/dev/null || true
        git -C "$repo_dir" reset --hard origin/master --quiet 2>/dev/null || {
            log_error "Failed to reset master to origin/master in $repo_name"
            exit $EXIT_GIT_FAILED
        }
        git -C "$repo_dir" clean -fd --quiet 2>/dev/null || true

        # ── Step 2: Create update branch ──────────────────────────────────

        log_info "Creating branch $update_branch in $repo_name..."
        git -C "$repo_dir" checkout -b "$update_branch" 2>/dev/null || {
            # Branch may already exist from a previous aborted run
            git -C "$repo_dir" checkout master 2>/dev/null || true
            git -C "$repo_dir" branch -D "$update_branch" 2>/dev/null || true
            git -C "$repo_dir" checkout -b "$update_branch" 2>/dev/null || {
                log_error "Failed to create branch $update_branch in $repo_name"
                exit $EXIT_GIT_FAILED
            }
        }

        # ── Step 3: Snapshot versions before update ───────────────────────

        local before_file after_file
        before_file=$(mktemp)
        after_file=$(mktemp)
        snapshot_versions "$repo_dir" > "$before_file"

        # ── Step 4: Run dependency update ─────────────────────────────────

        log_info "Updating NuGet references in $repo_name..."
        if ! cs-references-update "$repo_dir" 2>&1; then
            log_error "cs-references-update failed for $repo_name"
            rm -f "$before_file" "$after_file"
            git -C "$repo_dir" checkout -f master 2>/dev/null || true
            git -C "$repo_dir" branch -D "$update_branch" 2>/dev/null || true
            exit $EXIT_UPDATE_FAILED
        fi

        # ── Step 5: Detect breaking changes via version diff ──────────────

        snapshot_versions "$repo_dir" > "$after_file"

        local major_bumps
        major_bumps=$(detect_major_bumps "$before_file" "$after_file" 2>&1) && has_breaking=1
        rm -f "$before_file" "$after_file"

        if [ "$has_breaking" -eq 1 ]; then
            log_warn "Major version bumps detected in non-test code:"
            echo "$major_bumps"
        fi

        # ── Check if anything actually changed ────────────────────────────

        if git -C "$repo_dir" diff --quiet && git -C "$repo_dir" diff --cached --quiet; then
            log_info "No changes after update — skipping $repo_name"
            git -C "$repo_dir" checkout master 2>/dev/null || true
            git -C "$repo_dir" branch -D "$update_branch" 2>/dev/null || true
            exit $EXIT_NO_CHANGES
        fi
    fi

    # ── Step 6: Determine change level ────────────────────────────────────

    local change_level="patch"
    if [ "$has_breaking" -eq 1 ]; then
        log_warn "Breaking changes were detected in $repo_name (major version bumps)."
        change_level="major"
    fi

    local pr_title="${change_level}: update references"

    # ── Step 6: Run tests ────────────────────────────────────
    if [ -f "$repo_dir/run-tests" ]; then
        echo "Running tests..."
        if ! "$repo_dir/run-tests"; then
            log_warn "Tests failed for $repo_name"
            prompt_user "Please fix the issue in $repo_dir so that TESTS PASS, then press Enter to retry."

            if ! "$repo_dir/run-tests"; then
                log_error "Tests failed for $repo_name"
                exit $EXIT_TESTS_FAILED
            fi
        fi
        echo "Tests passed!"
    else
        echo "No test runner found at $repo_dir/run-tests; skipping tests."
    fi

    # ── Step 6: Commit and push (git hook will run tests) ──────────────────

    git -C "$repo_dir" add -A
    if ! (cd "$repo_dir" && git commit -m "${pr_title} [skip ci]" --quiet) 2>&1; then
        log_warn "Commit failed for $repo_name (likely a git hook failure)"
        prompt_user "Please fix the issue in $repo_dir so that COMMIT HOOKS PASS, then press Enter to retry."
        if ! (cd "$repo_dir" && git add -A && git commit -m "${pr_title} [skip ci]" --quiet) 2>&1; then
            log_error "Commit still failing for $repo_name — aborting"
            git -C "$repo_dir" checkout -f master 2>/dev/null || true
            git -C "$repo_dir" branch -D "$update_branch" 2>/dev/null || true
            exit $EXIT_TESTS_FAILED
        fi
    fi

    log_info "Pushing branch $update_branch..."
    if ! git -C "$repo_dir" push -u origin "$update_branch" --quiet 2>/dev/null; then
        # Force push in case branch exists on remote from a previous aborted run
        git -C "$repo_dir" push -u origin "$update_branch" --force --quiet 2>/dev/null || {
            log_error "Failed to push branch $update_branch for $repo_name"
            git -C "$repo_dir" checkout master 2>/dev/null || true
            git -C "$repo_dir" branch -D "$update_branch" 2>/dev/null || true
            exit $EXIT_GIT_FAILED
        }
    fi

    # ── Step 7: Create PR ──────────────────────────────────────────────────

    log_info "Creating PR: '$pr_title' for $repo_name..."
    sleep 3 # Wait a moment for GitHub to register the new branch before creating PR
    local pr_url=""
    local pr_attempt
    for pr_attempt in 1 2 3 4 5; do
        pr_url=$(pr-create-for-merge --no-issue --repo-dir "$repo_dir" --branch "$update_branch" --label "automated" "$pr_title" 2>&1 | grep -oE 'https://github.com[^ ]+' | head -1) || true
        [ -n "$pr_url" ] && break
        log_warn "PR creation attempt $pr_attempt failed — retrying in 10s..."
        echo "pr-create-for-merge --no-issue --repo-dir \"$repo_dir\" --branch \"$update_branch\" --label \"automated\" \"$pr_title\""
        sleep 10
    done

    if [ -z "$pr_url" ]; then
        log_error "Failed to create PR for $repo_name after 5 attempts"
        prompt_user "Please resolve the PR creation issue manually.  Merge it and then press Enter."
        git -C "$repo_dir" checkout master 2>/dev/null || true
        git -C "$repo_dir" branch -D "$update_branch" 2>/dev/null || true
        exit $EXIT_PR_FAILED
    else
        log_info "PR created: $pr_url"

        # ── Step 8: Merge PR ───────────────────────────────────────────────

        log_info "Merging PR for $repo_name..."
        if ! (cd "$repo_dir" && pr-complete-merge --force --no-issue-id "$pr_title") 2>&1; then
            log_error "Failed to merge PR for $repo_name"
            prompt_user "Please merge manually, then press Enter."
            git -C "$repo_dir" checkout master 2>/dev/null || true
            git -C "$repo_dir" branch -D "$update_branch" 2>/dev/null || true
            exit $EXIT_MERGE_FAILED
        else
            log_info "PR merged successfully"
        fi
    fi

    # ── Step 9: Return to master ───────────────────────────────────────────

    sleep 3
    git -C "$repo_dir" checkout master 2>/dev/null
    git -C "$repo_dir" pull --quiet 2>/dev/null || true
    git -C "$repo_dir" branch -D "$update_branch" 2>/dev/null || true
}

# ============================================================================
# Script Entry Point
# ============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
