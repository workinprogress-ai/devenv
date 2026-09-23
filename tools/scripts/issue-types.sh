#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# issue-types.sh - List the GitHub organization's issue types
# Version: 1.0.0
# Description: Queries the organization's configured issue types (ID + name)
#              via GraphQL. Read-only; used when setting up or verifying the
#              native issue-type vocabulary (tools/config/issues-config.yml).
# Requirements: Bash 4.0+, gh CLI, jq
# Author: WorkInProgress.ai
# Last Modified: 2026-09-08

set -euo pipefail
# shellcheck disable=SC2034  # VERBOSE is written here; read by log_verbose in error-handling.bash

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
#
# Org identity (policy_org) arrives transitively via github-helpers
# (which loads the policy layer); no explicit policy sourcing here.

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "List the GitHub organization's issue types"

# ============================================================================
# Global Variables
# ============================================================================

OUTPUT_FORMAT="table"
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
VERBOSE=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

List the GitHub organization's configured issue types (ID + name) via GraphQL.
Read-only — used when setting up or verifying the native issue-type vocabulary
(mirrors tools/config/issues-config.yml: Bug, Feature, Task, Epic).

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -f, --format FORMAT         Output format: table (default), json, simple

Environment Variables:
    GH_ORG                      Organization to query (falls back to the owner
                                part of GITHUB_REPO)

Examples:
    # List issue types
    $SCRIPT_NAME

    # JSON with node IDs (for org settings configuration)
    $SCRIPT_NAME --format json

EOF
    exit 0
}

resolve_org() {
    local policy_org
    policy_org=$(policy_org 2>/dev/null || true)
    if [ -n "$policy_org" ]; then
        echo "$policy_org"
        return 0
    fi
    if [ -n "${GITHUB_REPO:-}" ]; then
        echo "${GITHUB_REPO%%/*}"
        return 0
    fi
    log_error "Cannot resolve organization — configure [organization] github_org in devenv.config or set GITHUB_REPO"
    return 1
}

list_issue_types() {
    local org="$1"

    log_verbose "Querying issue types for org: $org"

    local raw
    if ! raw=$(provider_org_issue_types "$org" 2>/dev/null); then
        log_error "Failed to query issue types for org $org"
        exit 1
    fi

    local types
    types=$(echo "$raw" | jq -r '.data.organization.issueTypes.edges')
    if [ "$types" = "null" ] || [ -z "$types" ]; then
        log_error "No issue types returned — is the org configured with issue types? (GitHub org setting: Organization settings → Features → Issue types)"
        exit 1
    fi

    case "$OUTPUT_FORMAT" in
        json)
            echo "$raw" | jq '.data.organization.issueTypes.edges | map(.node)'
            ;;
        simple)
            echo "$raw" | jq -r '.data.organization.issueTypes.edges[].node | .name'
            ;;
        table)
            echo "$raw" | jq -r '.data.organization.issueTypes.edges[].node | "\(.name)\t\(.id)"' | column -t -s $'\t'
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
            -V|--verbose)
                # shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
                VERBOSE=1
                shift
                ;;
            # (no --devenv flag: org-level query, no target-repo ambiguity)
            -f|--format)  OUTPUT_FORMAT="$2"; shift 2 ;;
            *)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done

    # Resolve org (before any network/auth dependency)
    local org
    org=$(resolve_org) || exit 1

    ensure_gh_login
    check_dependencies

    list_issue_types "$org"
}

# Run main function
main "$@"
