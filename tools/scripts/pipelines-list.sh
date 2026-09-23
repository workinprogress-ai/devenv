#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# pipelines-list.sh - List workflow definitions across the org
# Version: 1.0.0
# Description: Lists GitHub Actions workflow definitions (name, file, state)
#              across org repositories. Shows what workflows exist, not their
#              run history.
# Requirements: Bash 4.0+, gh CLI, jq
# Author: WorkInProgress.ai
# Last Modified: 2026-05-16

set -euo pipefail
# shellcheck disable=SC2034  # VERBOSE is written here; read by log_verbose in error-handling.bash

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
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
VERBOSE=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

List GitHub Actions workflow definitions across org repositories.
Shows what workflows exist, not their run history. Use pipelines-status for that.

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
    (none required — org resolves via devenv.config [organization] github_org;
     GH_ORG remains an optional override.

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

list_workflows() {
    local org
    org=$(get_repo_owner)

    log_verbose "Fetching repos for org: $org"

    local repos
    if ! repos=$(provider_repos_list "$org" --limit 1000 --json name -q '.[].name' 2>/dev/null); then
        log_error "Failed to list repositories for org: $org"
        exit "$EXIT_API_FAILURE"
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
        wfs=$(provider_actions_workflow_list "$org/$repo" \
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


    # Global flags before auth: --help/--version must work without a
    # valid GitHub session.
    if handle_global_flag "${1:-}"; then
        exit 0
    fi

    ensure_gh_login


    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)    show_usage ;;
            -v|--version) echo "$SCRIPT_VERSION"; exit 0 ;;
            -V|--verbose)
                # shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
                VERBOSE=1
                shift
                ;;
            --json)       OUTPUT_FORMAT="json"; shift ;;
            --pretty)     OUTPUT_FORMAT="pretty"; shift ;;
            -r|--repo)
                REPO_REGEX="$2"; shift 2 ;;
            --state)
                STATE_FILTER="$2"; shift 2 ;;
            -*)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit "$EXIT_MISUSE" ;;
            *)
                log_error "Unexpected argument: $1"
                echo "Use --help for usage information"
                exit "$EXIT_MISUSE" ;;
        esac
    done

    list_workflows
}

main "$@"
