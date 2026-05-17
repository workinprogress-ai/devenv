#!/bin/bash
# actions-status.sh - Report GitHub Actions run status across the org
# Version: 1.0.0
# Description: Enumerates repos in the GitHub org and reports the latest
#              workflow run status, with optional filtering by repo name and
#              run conclusion.
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
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Report GitHub Actions run status across the org"

# ============================================================================
# Global Variables
# ============================================================================

REPO_REGEX=""         # grep -E pattern to filter repo names
STATUS_FILTER=""      # filter by conclusion: success | failure | cancelled | skipped
WORKFLOW_FILTER=""    # filter by exact workflow name
LIMIT="1"             # runs per repo (default: latest only)
OUTPUT_FORMAT="table" # table | json | pretty
VERBOSE=0

readonly RUN_FIELDS="workflowName,status,conclusion,headBranch,updatedAt,url,databaseId"

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

Report GitHub Actions workflow run status across the org.
Defaults to the latest run per repo. Uses GH_ORG to enumerate repositories.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --json                      Output as compact JSON
    --pretty                    Output as pretty-printed JSON

Filters:
    -r, --repo REGEX            Filter repos by name (extended regex, e.g. 'lib\.cs\.')
    -s, --status STATUS         Filter by conclusion: success, failure, cancelled, skipped
    -w, --workflow NAME         Filter by workflow name (exact match)
    --limit N                   Runs per repo to fetch (default: 1)

Environment Variables:
    GH_ORG                      GitHub organisation name (required)

Examples:
    # Show latest run status for all repos
    $SCRIPT_NAME

    # Only repos matching a name pattern
    $SCRIPT_NAME --repo 'lib\.cs\.'

    # Only failed runs
    $SCRIPT_NAME --status failure

    # Filter by repo and workflow, show as JSON
    $SCRIPT_NAME --repo 'services' --workflow CI --json

    # Pipe into jq for further processing
    $SCRIPT_NAME --json | jq '.[] | select(.conclusion == "failure") | .url'

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

list_action_runs() {
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

    local all_runs="[]"

    while IFS= read -r repo; do
        [ -z "$repo" ] && continue
        log_verbose "Fetching runs for $org/$repo..."

        local runs
        runs=$(gh run list -R "$org/$repo" \
            --limit "$LIMIT" \
            --json "$RUN_FIELDS" \
            2>/dev/null || echo "[]")

        [ "$runs" = "[]" ] && continue

        if [ -n "$WORKFLOW_FILTER" ]; then
            runs=$(echo "$runs" | jq --arg wf "$WORKFLOW_FILTER" \
                '[.[] | select(.workflowName == $wf)]')
        fi

        if [ -n "$STATUS_FILTER" ]; then
            runs=$(echo "$runs" | jq --arg s "$STATUS_FILTER" \
                '[.[] | select(.conclusion == $s or .status == $s)]')
        fi

        [ "$runs" = "[]" ] && continue

        runs=$(echo "$runs" | jq --arg r "$repo" '[.[] | . + {repo: $r}]')
        all_runs=$(printf '%s\n%s' "$all_runs" "$runs" | jq -s 'add')
    done <<< "$repos"

    case "$OUTPUT_FORMAT" in
        json)
            echo "$all_runs"
            ;;
        pretty)
            echo "$all_runs" | jq .
            ;;
        table)
            echo "$all_runs" | jq -r '
                (["REPO", "WORKFLOW", "BRANCH", "STATUS", "CONCLUSION", "UPDATED", "URL"]),
                (.[] | [
                    .repo,
                    .workflowName,
                    .headBranch,
                    .status,
                    (.conclusion // "-"),
                    (.updatedAt | split("T")[0]),
                    .url
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
            -s|--status)
                STATUS_FILTER="$2"; shift 2 ;;
            -w|--workflow)
                WORKFLOW_FILTER="$2"; shift 2 ;;
            --limit)
                if ! [[ "$2" =~ ^[0-9]+$ ]]; then
                    log_error "Invalid limit: $2 (must be a positive integer)"
                    exit 1
                fi
                LIMIT="$2"; shift 2 ;;
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

    list_action_runs
}

main "$@"
