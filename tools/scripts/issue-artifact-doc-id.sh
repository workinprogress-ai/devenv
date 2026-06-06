#!/bin/bash
# issue-artifact-doc-id.sh - Generate deterministic artifact doc_id values
# Version: 1.0.0
# Description: Builds stable doc_id strings for issue artifact comments.
# Requirements: Bash 4.0+

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Generate deterministic artifact doc_id values"

ISSUE_NUMBER=""
ARTIFACT_TYPE=""
SLUG=""
SOURCE_FILE=""
REPO_OVERRIDE=""
VERBOSE=0

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

Generate a deterministic doc_id in this format:
  dv1:<owner-repo>:issue-<number>:<artifact_type>:<slug>

Required Inputs:
  --issue N                    Issue number
  --artifact-type TYPE         One of: spike, redesign, design, blueprint,
                               requirements, roadmap, plan

Slug Source (exactly one required):
  --slug TEXT                  Slug source text (normalized to kebab-case)
  --source-file FILE           Use basename of file (without extension)

Optional:
  --repo OWNER/REPO            Override repository (default: GITHUB_REPO or current git repo)
  -V, --verbose                Enable verbose logging
  -h, --help                   Show help
  -v, --version                Show version

Examples:
  $SCRIPT_NAME --issue 123 --artifact-type spike --slug "retry strategy"
  $SCRIPT_NAME --issue 123 --artifact-type redesign --source-file Redesign--001.md
  $SCRIPT_NAME --issue 123 --artifact-type plan --slug "phase 1" --repo workinprogress-ai/devenv
EOF
    exit 0
}

invalid_args() {
    log_error "$1"
    echo "Use --help for usage information"
    exit 2
}

require_option_value() {
    local option_name="$1"
    local value="${2:-}"
    if [ -z "$value" ]; then
        invalid_args "Missing value for $option_name"
    fi
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

resolve_owner_repo() {
    if [ -n "$REPO_OVERRIDE" ]; then
        echo "$REPO_OVERRIDE"
        return
    fi

    if [ -n "${GITHUB_REPO:-}" ]; then
        echo "$GITHUB_REPO"
        return
    fi

    local git_root
    git_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
    if [ -z "$git_root" ]; then
        invalid_args "Repository is required: pass --repo or set GITHUB_REPO"
    fi

    local resolved_repo
    resolved_repo=$(get_full_repo_name "$git_root" 2>/dev/null || true)
    if [ -z "$resolved_repo" ]; then
        invalid_args "Could not resolve repository; pass --repo OWNER/REPO"
    fi

    echo "$resolved_repo"
}

main() {
    if [ $# -eq 0 ]; then
        invalid_args "Required arguments are missing"
    fi

    case "${1:-}" in
        -h|--help)
            show_usage
            ;;
        -v|--version)
            echo "$SCRIPT_VERSION"
            exit 0
            ;;
    esac

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                show_usage
                ;;
            -v|--version)
                echo "$SCRIPT_VERSION"
                exit 0
                ;;
            -V|--verbose)
                VERBOSE=1
                shift
                ;;
            --issue|--issue-number|--issue_number)
                require_option_value "$1" "${2:-}"
                ISSUE_NUMBER="$2"
                shift 2
                ;;
            --artifact-type|--artifact_type)
                require_option_value "$1" "${2:-}"
                ARTIFACT_TYPE="$2"
                shift 2
                ;;
            --slug)
                require_option_value "$1" "${2:-}"
                SLUG="$2"
                shift 2
                ;;
            --source-file|--source_file)
                require_option_value "$1" "${2:-}"
                SOURCE_FILE="$2"
                shift 2
                ;;
            --repo)
                require_option_value "$1" "${2:-}"
                REPO_OVERRIDE="$2"
                shift 2
                ;;
            *)
                invalid_args "Unknown option: $1"
                ;;
        esac
    done

    if [ -z "$ISSUE_NUMBER" ]; then
        invalid_args "issue number is required (--issue)"
    fi

    if [ -z "$ARTIFACT_TYPE" ]; then
        invalid_args "artifact type is required (--artifact-type)"
    fi

    local slug_sources=0
    [ -n "$SLUG" ] && slug_sources=$((slug_sources + 1))
    [ -n "$SOURCE_FILE" ] && slug_sources=$((slug_sources + 1))

    if [ "$slug_sources" -eq 0 ]; then
        invalid_args "One slug source is required: --slug or --source-file"
    fi

    if [ "$slug_sources" -gt 1 ]; then
        invalid_args "Only one of --slug or --source-file may be specified"
    fi

    if [ -n "$SOURCE_FILE" ]; then
        local source_name
        source_name=$(basename "$SOURCE_FILE")
        SLUG="${source_name%.*}"
    fi

    local owner_repo
    owner_repo=$(resolve_owner_repo)

    log_verbose "Using issue: $ISSUE_NUMBER"
    log_verbose "Using artifact type: $ARTIFACT_TYPE"
    log_verbose "Using slug source: $SLUG"
    log_verbose "Using repository: $owner_repo"

    local doc_id
    doc_id=$(generate_artifact_doc_id "$ISSUE_NUMBER" "$ARTIFACT_TYPE" "$SLUG" "$owner_repo") || exit 2

    echo "$doc_id"
}

main "$@"
