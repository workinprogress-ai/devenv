#!/bin/bash
# actions-list.sh - List workflow definitions across the org
# Version: 1.0.0
# Description: Lists GitHub Actions workflow definitions (name, file, state)
#              across org repositories. Shows what workflows exist, not their
#              run history.
# Requirements: Bash 4.0+, gh CLI, jq
# Author: WorkInProgress.ai
# Last Modified: 2026-05-16

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "List workflow definitions across the org"

# ============================================================================
# Global Variables
# ============================================================================

REPO_REGEX=""          # grep -E filter for repo names
STATE_FILTER="active"  # active | disabled_manually | disabled_inactivity | all
OUTPUT_FORMAT="table"  # table | json | pretty
VERBOSE=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

List GitHub Actions workflow definitions across org repositories.
Shows what workflows exist, not their run history. Use actions-status for that.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --json                      Output as compact JSON
    --pretty                    Output as pretty-printed JSON

Filters:
    -r, --repo REGEX            Filter repos by name (extended regex)
    --state STATE               Workflow state filter: active, disabled_manually,
                                disabled_inactivity, all (default: active)

Environment Variables:
    GH_ORG                      GitHub organisation name (required)

Examples:
    # List all active workflows
    $SCRIPT_NAME

    # Workflows for repos matching a pattern
    $SCRIPT_NAME --repo 'lib\.cs\.services\.'

    # Include disabled workflows
    $SCRIPT_NAME --state all

    # JSON output piped to jq
    $SCRIPT_NAME --json | jq '.[] | select(.state != "active")'

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

list_workflows() {
    local org
    org=$(get_repo_owner)

    log_verbose "Fetching repos for org: $org"

    local repos
    if ! repos=$(gh repo list "$org" --limit 1000 --json name -q '.[].name' 2>/dev/null); then
        log_error "Failed to list repositories for org: $org"
        exit 1
    fi

    if [ -z "$repos" ]; then
        log_warn "No repositories found for org: $org"
        exit 0
    fi

    if [ -n "$REPO_REGEX" ]; then
        repos=$(echo "$repos" | grep -E "$REPO_REGEX" || true)
    fi

    if [ -z "$repos" ]; then
        log_warn "No repositories matched filter: $REPO_REGEX"
        exit 0
    fi

    local all_workflows="[]"

    while IFS= read -r repo; do
        [ -z "$repo" ] && continue
        log_verbose "Fetching workflows for $org/$repo..."

        local wfs
        wfs=$(gh workflow list -R "$org/$repo" \
            --json id,name,path,state \
            2>/dev/null || echo "[]")

        [ "$wfs" = "[]" ] && continue

        if [ "$STATE_FILTER" != "all" ]; then
            wfs=$(echo "$wfs" | jq --arg s "$STATE_FILTER" \
                '[.[] | select(.state == $s)]')
        fi

        [ "$wfs" = "[]" ] && continue

        wfs=$(echo "$wfs" | jq --arg r "$repo" '[.[] | . + {repo: $r}]')
        all_workflows=$(printf '%s\n%s' "$all_workflows" "$wfs" | jq -s 'add')
    done <<< "$repos"

    case "$OUTPUT_FORMAT" in
        json)
            echo "$all_workflows"
            ;;
        pretty)
            echo "$all_workflows" | jq .
            ;;
        table)
            echo "$all_workflows" | jq -r '
                (["REPO", "WORKFLOW NAME", "FILE", "STATE"]),
                (.[] | [
                    .repo,
                    .name,
                    (.path | split("/")[-1]),
                    .state
                ])
                | @tsv
            ' | column -t -s $'\t'
            ;;
    esac
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    case "${1:-}" in
        -h|--help)    show_usage ;;
        -v|--version) echo "$SCRIPT_VERSION"; exit 0 ;;
    esac

    ensure_gh_login

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)    show_usage ;;
            -v|--version) echo "$SCRIPT_VERSION"; exit 0 ;;
            -V|--verbose) VERBOSE=1; shift ;;
            --json)       OUTPUT_FORMAT="json"; shift ;;
            --pretty)     OUTPUT_FORMAT="pretty"; shift ;;
            -r|--repo)
                REPO_REGEX="$2"; shift 2 ;;
            --state)
                STATE_FILTER="$2"; shift 2 ;;
            -*)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1 ;;
            *)
                log_error "Unexpected argument: $1"
                echo "Use --help for usage information"
                exit 1 ;;
        esac
    done

    list_workflows
}

main "$@"
