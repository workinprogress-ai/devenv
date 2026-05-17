#!/bin/bash
# actions-artifacts.sh - List or download artifacts from a GitHub Actions run
# Version: 1.0.0
# Description: Lists artifact metadata (name, size, ID) for a completed
#              GitHub Actions workflow run, or downloads them. Default is list.
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
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "List or download artifacts from a GitHub Actions run"

# ============================================================================
# Global Variables
# ============================================================================

RUN_ID=""
REPO=""
DOWNLOAD=0
ARTIFACT_NAME=""
DEST_DIR="."
OUTPUT_FORMAT="table"  # table | json | pretty
VERBOSE=0

# Warn before downloading more than 100 MiB at once without --name
readonly DOWNLOAD_SIZE_WARN_BYTES=104857600

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME RUN_ID --repo OWNER/REPO [OPTIONS]

List or download artifacts from a GitHub Actions workflow run.
Default mode is list (no files are downloaded).

Arguments:
    RUN_ID                      Workflow run ID

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --repo OWNER/REPO           Repository containing the run (required)
    --json                      Output artifact list as compact JSON
    --pretty                    Output artifact list as pretty-printed JSON
    --download                  Download artifacts instead of just listing
    --name NAME                 Artifact name to download (use with --download)
    --dir DIR                   Download destination directory (default: .)

Examples:
    # List artifacts for a run
    $SCRIPT_NAME 12345678 --repo workinprogress-ai/my-service

    # List as JSON and pipe to jq
    $SCRIPT_NAME 12345678 --repo workinprogress-ai/my-service --json | jq '.[].name'

    # Download all artifacts
    $SCRIPT_NAME 12345678 --repo workinprogress-ai/my-service --download

    # Download a specific artifact to a directory
    $SCRIPT_NAME 12345678 --repo workinprogress-ai/my-service \\
        --download --name coverage-report --dir /tmp/artifacts

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

# Splits OWNER/REPO into two words: owner repo
parse_repo() {
    local repo="$1"
    if [[ ! "$repo" =~ ^[^/]+/[^/]+$ ]]; then
        log_error "Invalid --repo format: '$repo' (expected OWNER/REPO)"
        exit 1
    fi
    echo "${repo%%/*}" "${repo##*/}"
}

list_artifacts() {
    local owner repo
    read -r owner repo <<< "$(parse_repo "$REPO")"

    log_verbose "Listing artifacts for run $RUN_ID in $REPO"

    local artifacts
    if ! artifacts=$(gh api \
        "/repos/$owner/$repo/actions/runs/$RUN_ID/artifacts" \
        --jq '.artifacts' 2>/dev/null); then
        log_error "Failed to fetch artifacts for run $RUN_ID in $REPO"
        exit 1
    fi

    if [ "$(echo "$artifacts" | jq 'length')" -eq 0 ]; then
        log_info "No artifacts found for run $RUN_ID"
        exit 0
    fi

    case "$OUTPUT_FORMAT" in
        json)
            echo "$artifacts"
            ;;
        pretty)
            echo "$artifacts" | jq .
            ;;
        table)
            echo "$artifacts" | jq -r '
                (["NAME", "SIZE", "ID", "CREATED"]),
                (.[] | [
                    .name,
                    ((.size_in_bytes | tostring) + "B"),
                    (.id | tostring),
                    (.created_at | split("T")[0])
                ])
                | @tsv
            ' | column -t -s $'\t'
            ;;
    esac
}

download_artifacts() {
    local owner repo
    read -r owner repo <<< "$(parse_repo "$REPO")"

    # When downloading all (no --name), warn if total size is large
    if [ -z "$ARTIFACT_NAME" ]; then
        local total_bytes
        total_bytes=$(gh api \
            "/repos/$owner/$repo/actions/runs/$RUN_ID/artifacts" \
            --jq '[.artifacts[].size_in_bytes] | add // 0' 2>/dev/null || echo "0")

        if [ "$total_bytes" -gt "$DOWNLOAD_SIZE_WARN_BYTES" ]; then
            local size_mib=$(( total_bytes / 1048576 ))
            log_warn "Total artifact size is approximately ${size_mib} MiB."
            log_warn "Use --name to download a specific artifact, or proceed carefully."
            read -r -p "Continue downloading all artifacts? [y/N] " confirm
            [[ "$confirm" =~ ^[Yy]$ ]] || exit 0
        fi
    fi

    local gh_args=()
    gh_args+=(-R "$REPO")
    [ -n "$ARTIFACT_NAME" ] && gh_args+=(-n "$ARTIFACT_NAME")
    gh_args+=(-D "$DEST_DIR")

    log_verbose "Downloading artifacts for run $RUN_ID from $REPO to $DEST_DIR"

    if ! gh run download "$RUN_ID" "${gh_args[@]}"; then
        log_error "Failed to download artifacts for run $RUN_ID"
        exit 1
    fi

    log_info "Artifacts downloaded to: $DEST_DIR"
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
            --json)
                OUTPUT_FORMAT="json"; shift ;;
            --pretty)
                OUTPUT_FORMAT="pretty"; shift ;;
            --download)
                DOWNLOAD=1; shift ;;
            --name)
                ARTIFACT_NAME="$2"; shift 2 ;;
            --dir)
                DEST_DIR="$2"; shift 2 ;;
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

    if [ "$DOWNLOAD" -eq 1 ]; then
        download_artifacts
    else
        list_artifacts
    fi
}

main "$@"
