#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# pipelines-run.sh - Trigger a GitHub Actions workflow dispatch event
# Version: 1.0.0
# Description: Triggers a workflow_dispatch event on a GitHub repository and
#              reports the resulting run URL.
# Requirements: Bash 4.0+, gh CLI
# Author: WorkInProgress.ai
# Last Modified: 2026-05-16

set -euo pipefail
# shellcheck disable=SC2034  # VERBOSE is written here; read by log_verbose in error-handling.bash

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/provider-loader.bash"

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
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
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
    $SCRIPT_NAME ci.yml --repo <org>/my-service

    # Run on a specific branch
    $SCRIPT_NAME ci.yml --repo <org>/my-service --ref feature/my-branch

    # Pass workflow_dispatch inputs
    $SCRIPT_NAME deploy.yml --repo <org>/my-service \\
        --input environment=staging \\
        --input version=1.2.3

EOF
    exit 0
}

trigger_workflow() {
    local trigger_args=()
    [ -n "$REF" ] && trigger_args+=(--ref "$REF")
    for input in "${INPUTS[@]}"; do
        trigger_args+=(--field "$input")
    done

    log_verbose "Triggering workflow '$WORKFLOW' in $REPO${REF:+ on $REF}"

    # Repo and workflow go positionally: the facade verb's signature is
    # provider_pipelines_workflow_run [repo] WORKFLOW [flags...] and it builds
    # the -R form itself. Feeding it a prebuilt (-R repo ...) array made the
    # leading -R land in the optional-repo slot, producing "gh workflow run
    # -R -R ...".
    if ! provider_pipelines_workflow_run "$REPO" "$WORKFLOW" "${trigger_args[@]}"; then
        log_error "Failed to trigger workflow: $WORKFLOW"
        exit 1
    fi

    log_info "Workflow queued. Fetching run URL..."

    # gh workflow run does not return a run ID or URL. Poll after a short delay.
    # This is a known gh CLI limitation — the run may not appear immediately.
    sleep 2

    local run_url
    run_url=$(provider_pipelines_run_list "$REPO" \
        --workflow "$WORKFLOW" \
        --limit 1 \
        --json url \
        -q '.[0].url' 2>/dev/null || echo "")

    if [ -n "$run_url" ] && [ "$run_url" != "null" ]; then
        log_info "Run URL: $run_url"
    else
        log_warn "Run queued but URL not yet available."
        log_warn "Check: provider_pipelines_run_list $REPO --workflow $WORKFLOW"
    fi
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
