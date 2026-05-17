#!/bin/bash
# actions-rerun.sh - Re-run a GitHub Actions workflow run
# Version: 1.0.0
# Description: Re-runs a GitHub Actions workflow run, with options to
#              re-run only failed jobs or enable debug logging.
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
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Re-run a GitHub Actions workflow run"

# ============================================================================
# Global Variables
# ============================================================================

RUN_ID=""
REPO=""
FAILED_ONLY=0
DEBUG_MODE=0
VERBOSE=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME RUN_ID --repo OWNER/REPO [OPTIONS]

Re-run a GitHub Actions workflow run.

Arguments:
    RUN_ID                      The workflow run ID to re-run

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --repo OWNER/REPO           Repository containing the run (required)
    --failed                    Re-run only failed jobs (not the whole workflow)
    --debug                     Enable debug logging for the re-run

Examples:
    # Re-run the full workflow
    $SCRIPT_NAME 12345678 --repo workinprogress-ai/my-service

    # Re-run only failed jobs
    $SCRIPT_NAME 12345678 --repo workinprogress-ai/my-service --failed

    # Re-run with debug output enabled
    $SCRIPT_NAME 12345678 --repo workinprogress-ai/my-service --debug

    # Combine: failed jobs with debug
    $SCRIPT_NAME 12345678 --repo workinprogress-ai/my-service --failed --debug

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

rerun_workflow() {
    local gh_args=()
    gh_args+=(-R "$REPO")
    [ "$FAILED_ONLY" -eq 1 ] && gh_args+=(--failed)
    [ "$DEBUG_MODE" -eq 1 ]  && gh_args+=(-d)

    log_verbose "Re-running run $RUN_ID in $REPO (failed-only=$FAILED_ONLY debug=$DEBUG_MODE)"

    if ! gh run rerun "$RUN_ID" "${gh_args[@]}"; then
        log_error "Failed to re-run workflow run: $RUN_ID"
        exit 1
    fi

    local run_url
    run_url=$(gh run view "$RUN_ID" -R "$REPO" --json url -q '.url' 2>/dev/null || echo "")

    if [ -n "$run_url" ]; then
        log_info "Re-run queued: $run_url"
    else
        log_info "Re-run queued for run $RUN_ID in $REPO"
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
            --failed)
                FAILED_ONLY=1; shift ;;
            --debug)
                DEBUG_MODE=1; shift ;;
            -*)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1 ;;
            *)
                if [ -z "$RUN_ID" ]; then
                    RUN_ID="$1"
                    shift
                else
                    log_error "Unexpected argument: $1"
                    echo "Use --help for usage information"
                    exit 1
                fi ;;
        esac
    done

    if [ -z "$RUN_ID" ]; then
        log_error "RUN_ID is required"
        echo "Use --help for usage information"
        exit 1
    fi

    if [ -z "$REPO" ]; then
        log_error "--repo OWNER/REPO is required"
        echo "Use --help for usage information"
        exit 1
    fi

    rerun_workflow
}

main "$@"
