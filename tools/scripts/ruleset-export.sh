#!/bin/bash
# ruleset-export.sh - Export a GitHub repository ruleset as JSON
# Version: 1.0.0
# Description: Fetches a single repository ruleset by ID (or lists a repo's
#              rulesets when no ID is given) as JSON. Read-only; used for
#              backing up or inspecting branch-protection rulesets.
# Requirements: Bash 4.0+, gh CLI
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
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Export a GitHub repository ruleset as JSON"

# ============================================================================
# Global Variables
# ============================================================================

RULESET_ID=""
OUTPUT_FILE=""
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [RULESET_ID] [OPTIONS]

Export a GitHub repository ruleset as JSON. With no RULESET_ID, lists the
repository's rulesets (id, name, enforcement) instead. Read-only.

Arguments:
    RULESET_ID                  Numeric ruleset ID to export (omit to list)

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -o, --output FILE           Write JSON to FILE instead of stdout
    --devenv                    Safety override to target the devenv repo

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: curren
t repo)

Examples:
    # List this repo's rulesets
    $SCRIPT_NAME

    # Export one ruleset to stdout
    $SCRIPT_NAME 8612

    # Export to a file
    $SCRIPT_NAME 8612 --output ruleset-backup.json

    # Find the ID first, then export
    $SCRIPT_NAME            # lists id + name
    $SCRIPT_NAME <id>

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

resolve_owner_repo() {
    if [ -n "${GITHUB_REPO:-}" ]; then
        echo "$GITHUB_REPO"
        return 0
    fi
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"
    # get_repo_spec yields -R owner/repo (or empty when resolved from cwd)
    if [ -n "${repo_spec[1]:-}" ]; then
        echo "${repo_spec[1]}"
        return 0
    fi
    log_error "Cannot resolve target repository — set GITHUB_REPO"
    return 1
}

export_ruleset() {
    local owner_repo
    owner_repo=$(resolve_owner_repo) || exit 1

    if [ -z "$RULESET_ID" ]; then
        log_verbose "Listing rulesets for $owner_repo"
        local raw
        if ! raw=$(gh api "repos/$owner_repo/rulesets" --paginate 2>/dev/null); then
            log_error "Failed to list rulesets"
            exit 1
        fi
        echo "$raw" | jq -r '.[] | "\(.id)  \(.name)  \(.enforcement)"'
        return 0
    fi

    log_verbose "Exporting ruleset $RULESET_ID from $owner_repo"
    local raw
    if ! raw=$(gh api "repos/$owner_repo/rulesets/$RULESET_ID" 2>/dev/null); then
        log_error "Failed to fetch ruleset $RULESET_ID"
        exit 1
    fi

    if [ -n "$OUTPUT_FILE" ]; then
        echo "$raw" | jq . > "$OUTPUT_FILE"
        log_info "Ruleset $RULESET_ID written to $OUTPUT_FILE"
    else
        echo "$raw" | jq .
    fi
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    # First non-flag argument is the ruleset ID
    if [ $# -gt 0 ] && ! [[ "$1" =~ ^- ]]; then
        RULESET_ID="$1"
        if ! [[ "$RULESET_ID" =~ ^[0-9]+$ ]]; then
            log_error "Invalid ruleset ID: $RULESET_ID (must be numeric)"
            exit 1
        fi
        shift
    fi

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)    show_usage ;;
            -v|--version) echo "$SCRIPT_VERSION"; exit 0 ;;
            -V|--verbose) VERBOSE=1; shift ;;
            -o|--output)  OUTPUT_FILE="$2"; shift 2 ;;
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

    export_ruleset
}

# Run main function
main "$@"
