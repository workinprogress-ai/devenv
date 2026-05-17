#!/bin/bash
# actions-run.sh - Trigger a GitHub Actions workflow dispatch event
# Version: 1.0.0
# Description: Triggers a workflow_dispatch event on a GitHub repository and
#              reports the resulting run URL.
# Requirements: Bash 4.0+, gh CLI
# Author: WorkInProgress.ai
# Last Modified: 2026-05-16

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Trigger a GitHub Actions workflow dispatch event"

# ============================================================================
# Global Variables
# ============================================================================

WORKFLOW=""   # workflow file name or display name (required positional)
REPO=""       # owner/repo (required)
REF=""        # branch/tag (optional, defaults to repo default branch)
INPUTS=()     # KEY=VALUE pairs for workflow_dispatch inputs
VERBOSE=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME WORKFLOW --repo OWNER/REPO [OPTIONS]

Trigger a GitHub Actions workflow_dispatch event. After queuing, polls briefly
to print the run URL.

Note: 'gh workflow run' does not return a run ID directly. The run URL is
retrieved by polling 'gh run list' after a short delay — it may occasionally
miss a run if the system is busy. This is a known gh CLI limitation.

Arguments:
    WORKFLOW                    Workflow file name (e.g. ci.yml) or display name

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --repo OWNER/REPO           Repository to run workflow in (required)
    --ref REF                   Branch or tag to run on (default: repo default branch)
    --input KEY=VALUE           Workflow dispatch input (repeatable)

Examples:
    # Trigger CI on the default branch
    $SCRIPT_NAME ci.yml --repo workinprogress-ai/my-service

    # Run on a specific branch
    $SCRIPT_NAME ci.yml --repo workinprogress-ai/my-service --ref feature/my-branch

    # Pass workflow_dispatch inputs
    $SCRIPT_NAME deploy.yml --repo workinprogress-ai/my-service \\
        --input environment=staging \\
        --input version=1.2.3

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

trigger_workflow() {
    local gh_args=()
    gh_args+=(-R "$REPO")
    [ -n "$REF" ] && gh_args+=(--ref "$REF")
    for input in "${INPUTS[@]}"; do
        gh_args+=(--field "$input")
    done

    log_verbose "Triggering workflow '$WORKFLOW' in $REPO${REF:+ on $REF}"

    if ! gh workflow run "$WORKFLOW" "${gh_args[@]}"; then
        log_error "Failed to trigger workflow: $WORKFLOW"
        exit 1
    fi

    log_info "Workflow queued. Fetching run URL..."

    # gh workflow run does not return a run ID or URL. Poll after a short delay.
    # This is a known gh CLI limitation — the run may not appear immediately.
    sleep 2

    local run_url
    run_url=$(gh run list -R "$REPO" \
        --workflow "$WORKFLOW" \
        --limit 1 \
        --json url \
        -q '.[0].url' 2>/dev/null || echo "")

    if [ -n "$run_url" ] && [ "$run_url" != "null" ]; then
        log_info "Run URL: $run_url"
    else
        log_warn "Run queued but URL not yet available."
        log_warn "Check: gh run list -R $REPO --workflow $WORKFLOW"
    fi
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
            --repo)
                REPO="$2"; shift 2 ;;
            --ref)
                REF="$2"; shift 2 ;;
            --input)
                INPUTS+=("$2"); shift 2 ;;
            -*)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1 ;;
            *)
                if [ -z "$WORKFLOW" ]; then
                    WORKFLOW="$1"
                    shift
                else
                    log_error "Unexpected argument: $1"
                    echo "Use --help for usage information"
                    exit 1
                fi ;;
        esac
    done

    if [ -z "$WORKFLOW" ]; then
        log_error "WORKFLOW is required"
        echo "Use --help for usage information"
        exit 1
    fi

    if [ -z "$REPO" ]; then
        log_error "--repo OWNER/REPO is required"
        echo "Use --help for usage information"
        exit 1
    fi

    trigger_workflow
}

main "$@"
