#!/bin/bash
# release-list.sh - List GitHub releases for a repository
# Version: 1.0.0
# Description: Lists releases (tag, name, published date, prerelease/draft flags,
#              URL) for the target repository. Read-only.
# Requirements: Bash 4.0+, gh CLI, jq
# Author: WorkInProgress.ai
# Last Modified: 2026-09-08

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "List GitHub releases for a repository"

# ============================================================================
# Global Variables
# ============================================================================

OUTPUT_FORMAT="table"
LIMIT=20
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

List GitHub releases (tag, name, published date, prerelease/draft flags, URL)
for the target repository. Read-only.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -f, --format FORMAT         Output format: table (default), json, simple
    -n, --limit NUMBER          Max releases to show (default: 20)
    --devenv                    Safety override to list releases in devenv repo

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: curren
t repo)

Examples:
    # Latest releases
    $SCRIPT_NAME

    # JSON for scripting
    $SCRIPT_NAME --format json --limit 5

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

list_releases() {
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"

    local raw
    if ! raw=$(gh release list "${repo_spec[@]}" --limit "$LIMIT" --json tagName,name,publishedAt,isPrerelease,isDraft 2>/dev/null); then
        log_error "Failed to list releases"
        exit 1
    fi

    case "$OUTPUT_FORMAT" in
        json)
            echo "$raw" | jq .
            ;;
        simple)
            echo "$raw" | jq -r '.[] | "\(.tagName) — \(.name // "(untitled)") [\(.publishedAt // "unpublished")]"'
            ;;
        table)
            echo "$raw" | jq -r '.[] | "\(if .isDraft then "DRAFT" elif .isPrerelease then "PRE" else "REL" end)  \(.tagName)  \(.publishedAt // "unpublished" | split("T")[0])  \(.name // "(untitled)")"'
            ;;
        *)
            log_error "Invalid format: $OUTPUT_FORMAT (must be table, json, or simple)"
            exit 1
            ;;
    esac
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)    show_usage ;;
            -v|--version) echo "$SCRIPT_VERSION"; exit 0 ;;
            -V|--verbose) VERBOSE=1; shift ;;
            -f|--format)  OUTPUT_FORMAT="$2"; shift 2 ;;
            -n|--limit)   LIMIT="$2"; shift 2 ;;
            --devenv)     # shellcheck disable=SC2034  # Used by check_target_repo
                          ALLOW_DEVENV_REPO=1; shift ;;
            *)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done

    check_dependencies
    check_target_repo
    ensure_gh_login

    list_releases
}

# Run main function
main "$@"
