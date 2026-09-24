#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# issue-get.sh - Retrieve GitHub issue details as structured JSON
# Version: 1.1.0
# Description: Fetches a single issue's data as JSON for scripting and automation
# Requirements: Bash 4.0+, gh CLI, jq
# Author: WorkInProgress.ai
# Last Modified: 2026-05-08

set -euo pipefail
# shellcheck disable=SC2034  # VERBOSE is written here; read by log_verbose in error-handling.bash

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/provider-loader.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

readonly SCRIPT_VERSION="1.1.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Retrieve GitHub issue details as structured JSON"

# ============================================================================
# Global Variables
# ============================================================================

ISSUE_NUMBER=""
OUTPUT_FORMAT="json"   # json | pretty
FORMAT_FIELD=""
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
VERBOSE=0
ALLOW_DEVENV_REPO=0

# Default fields returned in JSON output
readonly DEFAULT_FIELDS="number,title,body,state,labels,assignees,milestone,author,createdAt,updatedAt,closedAt,url,comments"

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME ISSUE_NUMBER [OPTIONS]

Retrieve a GitHub issue's details as structured JSON.

Arguments:
    ISSUE_NUMBER                Issue number to retrieve

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --pretty                    Pretty-print JSON output (default: compact)
    --format FIELD              Print one field as raw text (title, body, state,
                                url, number, author) — replaces jq -r pipelines
    --devenv                    Safety override to read issues in devenv repo

Environment Variables:
    DEVENV_REPO                 Repository in format owner/repo (default: current repo)

Output Fields:
    number       Issue number
    title        Issue title
    body         Issue description (markdown)
    state        open or closed
    labels       Array of label objects {name, color, description}
    assignees    Array of assignee objects {login, name}
    milestone    Milestone object {title, number, state} or null
    author       Author object {login, name}
    createdAt    ISO 8601 creation timestamp
    updatedAt    ISO 8601 last-updated timestamp
    closedAt     ISO 8601 close timestamp or null
    url          Issue URL
    comments     Number of comments

Examples:
    # Get issue as JSON
    $SCRIPT_NAME 123

    # Pretty-printed
    $SCRIPT_NAME 123 --pretty

    # Extract a single field
    $SCRIPT_NAME 123 --format title

    # Get the issue body as markdown
    $SCRIPT_NAME 123 --format body

    # Label names (comma-joined)
    $SCRIPT_NAME 123 --format labels

    # Pipe into another script
    $SCRIPT_NAME 123 --format state

EOF
    exit 0
}

# Fetch and output the issue
get_issue() {
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"

    log_verbose "Fetching issue #$ISSUE_NUMBER"

    local json
    # shellcheck disable=SC2054  # gh CLI uses comma-separated fields, not array expansion
    if ! json=$(provider_issues_view "${repo_spec[1]:-}" "$ISSUE_NUMBER" \
            --json "$DEFAULT_FIELDS" 2>/dev/null); then
        log_error "Issue #$ISSUE_NUMBER not found"
        exit $EXIT_API_FAILURE
    fi

    if [ -n "$FORMAT_FIELD" ]; then
        case "$FORMAT_FIELD" in
            labels)
                echo "$json" | jq -r '[.labels[].name] | join(",")'
                ;;
            *)
                echo "$json" | jq -r --arg f "$FORMAT_FIELD" '.[$f] // empty'
                ;;
        esac
        return
    fi

    if [ "$OUTPUT_FORMAT" = "pretty" ]; then
        echo "$json" | jq .
    else
        echo "$json"
    fi
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    if [ $# -eq 0 ]; then
        log_error "Issue number is required"
        echo "Use --help for usage information"
        exit $EXIT_MISUSE
    fi


    # Global flags before auth/validation: --help must work without
    # a valid GitHub session or any positional args.
    if handle_global_flag "${1:-}"; then
        exit 0
    fi

    ensure_gh_login

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
            --pretty)
                OUTPUT_FORMAT="pretty"
                shift
                ;;
            --format)
                FORMAT_FIELD="$2"
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
                if [ -z "$ISSUE_NUMBER" ]; then
                    if ! validate_issue_number "$1"; then
                        log_error "Invalid issue number: $1"
                        exit $EXIT_MISUSE
                    fi
                    ISSUE_NUMBER="$1"
                else
                    log_error "Unexpected argument: $1"
                    echo "Use --help for usage information"
                    exit $EXIT_MISUSE
                fi
                shift
                ;;
        esac
    done

    if [ -z "$ISSUE_NUMBER" ]; then
        log_error "Issue number is required"
        echo "Use --help for usage information"
        exit $EXIT_MISUSE
    fi

    check_target_repo

    get_issue
}

main "$@"
