#!/bin/bash
# issue-label-list.sh - List a repository's available issue labels
# Version: 1.0.0
# Description: Lists the repo's label vocabulary (name, description, color) so
#              triage and labeling flows suggest only labels that exist.
#              Read-only. Complements issue-search (duplicate detection) and
#              issue-update (label application).
# Requirements: Bash 4.0+, gh CLI, jq
# Author: WorkInProgress.ai
# Last Modified: 2026-09-08

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "List a repository's available issue labels"

# ============================================================================
# Global Variables
# ============================================================================

OUTPUT_FORMAT="table"
SEARCH_TERM=""
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

List a repository's available issue labels (name, description, color).
Read-only — use before suggesting labels in triage so only existing labels
are proposed. Create missing labels with issue-label-create.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -f, --format FORMAT         Output format: table (default), json, simple
    -s, --search TERM           Filter labels by substring (case-insensitive)
    --devenv                    Safety override to list labels in devenv repo

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: curren
t repo)

Examples:
    # List all labels
    $SCRIPT_NAME

    # Find priority labels
    $SCRIPT_NAME --search priority

    # JSON for scripting
    $SCRIPT_NAME --format json

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

list_labels() {
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"

    local raw
    log_verbose "Fetching labels"
    if ! raw=$(gh label list "${repo_spec[@]}" --limit 200 --json name,description,color 2>/dev/null); then
        log_error "Failed to list labels"
        exit 1
    fi

    if [ -n "$SEARCH_TERM" ]; then
        # shellcheck disable=SC2016  # jq program, not shell
        raw=$(echo "$raw" | jq --arg term "$SEARCH_TERM" '[.[] | select((.name | ascii_downcase) | contains($term | ascii_downcase))]')
    fi

    case "$OUTPUT_FORMAT" in
        json)
            echo "$raw" | jq .
            ;;
        simple)
            echo "$raw" | jq -r '.[].name'
            ;;
        table)
            echo "$raw" | jq -r '.[] | "\(.name)\t\(.color)\t\(.description // "")"' | column -t -s $'\t'
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
            -s|--search)  SEARCH_TERM="$2"; shift 2 ;;
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
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

    list_labels
}

# Run main function
main "$@"
