#!/bin/bash
# actions-watch.sh - Follow a GitHub Actions workflow run's live logs
# Version: 1.0.0
# Description: Streams live output from a running GitHub Actions workflow run.
#              If no RUN_ID is given, auto-detects the latest in-progress run.
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
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Follow a GitHub Actions workflow run's live logs"

# ============================================================================
# Global Variables
# ============================================================================

RUN_ID=""      # optional — auto-detects latest in-progress if omitted
REPO=""        # owner/repo (required)
EXIT_STATUS=0  # set to 1 to exit non-zero if the run fails
VERBOSE=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [RUN_ID] --repo OWNER/REPO [OPTIONS]

Stream live output from a GitHub Actions workflow run.
If RUN_ID is omitted, auto-detects the latest in-progress run in the repo.

Arguments:
    RUN_ID                      Workflow run ID to watch (optional)

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --repo OWNER/REPO           Repository containing the run (required)
    --exit-status               Exit non-zero if the watched run fails
                                (useful when scripting CI pipelines)

Examples:
    # Watch the latest in-progress run
    $SCRIPT_NAME --repo workinprogress-ai/my-service

    # Watch a specific run
    $SCRIPT_NAME 12345678 --repo workinprogress-ai/my-service

    # Exit with the run's exit code (for CI use)
    $SCRIPT_NAME 12345678 --repo workinprogress-ai/my-service --exit-status

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

watch_run() {
    local run_id="$RUN_ID"

    if [ -z "$run_id" ]; then
        log_info "No RUN_ID provided — detecting latest in-progress run for $REPO..."

        run_id=$(gh run list -R "$REPO" \
            --status in_progress \
            --limit 1 \
            --json databaseId \
            -q '.[0].databaseId' 2>/dev/null || echo "")

        if [ -z "$run_id" ] || [ "$run_id" = "null" ]; then
            log_error "No in-progress runs found for $REPO"
            exit 1
        fi

        log_info "Found in-progress run: $run_id"
    fi

    local gh_args=()
    gh_args+=(-R "$REPO")
    [ "$EXIT_STATUS" -eq 1 ] && gh_args+=(--exit-status)

    log_verbose "Watching run $run_id in $REPO"
    gh run watch "$run_id" "${gh_args[@]}"
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
            --exit-status)
                EXIT_STATUS=1; shift ;;
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

    if [ -z "$REPO" ]; then
        log_error "--repo OWNER/REPO is required"
        echo "Use --help for usage information"
        exit 1
    fi

    watch_run
}

main "$@"
