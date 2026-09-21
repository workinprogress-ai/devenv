#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# pr-diff.sh - Fetch a PR or branch diff as text
# Version: 1.0.0
# Description: Outputs a unified diff for a given PR number, or between two refs
# Requirements: Bash 4.0+, gh CLI, git
# Author: WorkInProgress.ai
# Last Modified: 2026-05-08

set -euo pipefail
# shellcheck disable=SC2034  # VERBOSE is written here; read by log_verbose in error-handling.bash

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Fetch a PR or branch diff as text"

# ============================================================================
# Global Variables
# ============================================================================

PR_NUMBER=""
BASE_REF=""
HEAD_REF=""
NAME_ONLY=0
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME PR_NUMBER [OPTIONS]
       $SCRIPT_NAME --base BASE_REF --head HEAD_REF [OPTIONS]

Fetch a unified diff for a pull request, or for the difference between two
refs in the current local repository.

PR mode (remote, via gh):
    PR_NUMBER                   Pull request number to diff

Ref mode (local git):
    --base BASE_REF             Base ref (e.g. master, main, abc123)
    --head HEAD_REF             Head ref (e.g. feature-branch, def456)

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --name-only                 List changed file paths only (no diff content)
    --devenv                    Safety override for devenv repo

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)

Examples:
    # Diff for PR #123
    $SCRIPT_NAME 123

    # Just the changed file list
    $SCRIPT_NAME 123 --name-only

    # Local diff between two refs
    $SCRIPT_NAME --base master --head my-feature-branch

    # Pipe into a reviewer
    $SCRIPT_NAME 123 | less

EOF
    exit 0
}

# Validate PR number is a positive integer
validate_pr_number() {
    local pr="$1"
    if [ -z "$pr" ]; then
        log_error "PR number cannot be empty"
        return 1
    fi
    if ! [[ "$pr" =~ ^[0-9]+$ ]]; then
        log_error "Invalid PR number: $pr (must be numeric)"
        return 1
    fi
    return 0
}

# Diff a PR via gh
diff_pr() {
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"

    log_verbose "Fetching diff for PR #$PR_NUMBER"

    if [ "$NAME_ONLY" -eq 1 ]; then
        if ! provider_prs_diff "${repo_spec[1]:-}" "$PR_NUMBER" --name-only 2>/dev/null; then
            log_error "Failed to fetch diff for PR #$PR_NUMBER"
            exit $EXIT_API_FAILURE
        fi
    else
        if ! provider_prs_diff "${repo_spec[1]:-}" "$PR_NUMBER" 2>/dev/null; then
            log_error "Failed to fetch diff for PR #$PR_NUMBER"
            exit $EXIT_API_FAILURE
        fi
    fi
}

# Diff two local refs via git
diff_refs() {
    log_verbose "Diffing $BASE_REF..$HEAD_REF"

    if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
        log_error "Base ref not found: $BASE_REF"
        exit $EXIT_API_FAILURE
    fi
    if ! git rev-parse --verify "$HEAD_REF" >/dev/null 2>&1; then
        log_error "Head ref not found: $HEAD_REF"
        exit $EXIT_API_FAILURE
    fi

    if [ "$NAME_ONLY" -eq 1 ]; then
        git --no-pager diff --name-only "$BASE_REF".."$HEAD_REF"
    else
        git --no-pager diff "$BASE_REF".."$HEAD_REF"
    fi
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    if [ $# -eq 0 ]; then
        log_error "PR number or --base/--head pair is required"
        echo "Use --help for usage information"
        exit $EXIT_MISUSE
    fi


    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                show_usage
                ;;
            -v|--version)
                echo "$SCRIPT_VERSION"
                exit 0
                ;;
            -V|--verbose)
                # shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
                VERBOSE=1
                shift
                ;;
            --name-only)
                NAME_ONLY=1
                shift
                ;;
            --base)
                BASE_REF="$2"
                shift 2
                ;;
            --head)
                HEAD_REF="$2"
                shift 2
                ;;
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
                ALLOW_DEVENV_REPO=1
                shift
                ;;
            -*)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit $EXIT_MISUSE
                ;;
            *)
                if [ -z "$PR_NUMBER" ]; then
                    if ! validate_pr_number "$1"; then
                        exit "$EXIT_MISUSE"
                    fi
                    PR_NUMBER="$1"
                else
                    log_error "Unexpected argument: $1"
                    echo "Use --help for usage information"
                    exit $EXIT_MISUSE
                fi
                shift
                ;;
        esac
    done

    # Mode validation: exactly one of {PR_NUMBER} or {BASE_REF + HEAD_REF}
    local pr_mode=0
    local ref_mode=0
    [ -n "$PR_NUMBER" ] && pr_mode=1
    [ -n "$BASE_REF" ] || [ -n "$HEAD_REF" ] && ref_mode=1

    if [ "$pr_mode" -eq 1 ] && [ "$ref_mode" -eq 1 ]; then
        log_error "Use either PR_NUMBER or --base/--head, not both"
        exit "$EXIT_GENERAL_ERROR"
    fi

    if [ "$pr_mode" -eq 0 ] && [ "$ref_mode" -eq 0 ]; then
        log_error "PR number or --base/--head pair is required"
        exit $EXIT_MISUSE
    fi

    if [ "$ref_mode" -eq 1 ]; then
        if [ -z "$BASE_REF" ] || [ -z "$HEAD_REF" ]; then
            log_error "Both --base and --head are required in ref mode"
            exit $EXIT_MISUSE
        fi
        diff_refs
    else
        ensure_gh_login
        check_target_repo
        diff_pr
    fi
}

main "$@"
