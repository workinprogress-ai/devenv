#!/bin/bash
# issue-artifact-select.sh - Resolve a single issue artifact from issue comments
# Version: 1.0.0
# Description: Selects exactly one artifact by doc_id, latest update, or single-match rule.
# Requirements: Bash 4.0+, jq, issue-artifact-list wrapper on PATH

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Select exactly one issue artifact"

ISSUE_NUMBER=""
ARTIFACT_TYPE=""
DOC_ID=""
SELECT_LATEST=0
REPO_OVERRIDE=""
OUTPUT_FORMAT="json"   # json | doc-id | comment-id | url
PRETTY=0
VERBOSE=0

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

Resolve exactly one issue artifact comment for downstream workflows.

Required Inputs:
    --issue, --issue-number N     Issue number

Optional Filters:
    --artifact-type TYPE          Filter by artifact type (for example: implementation-plan)
    --doc-id ID                   Select a specific artifact by doc_id
    --latest                      If multiple matches, select the most recently updated

Options:
    -f, --format FORMAT           Output format: json, doc-id, comment-id, url (default: json)
    --pretty                      Pretty-print JSON output
    --repo OWNER/REPO             Repository override (defaults to GITHUB_REPO)
    -V, --verbose                 Enable verbose logs
    -h, --help                    Show help and exit
    -v, --version                 Show version and exit

Selection rules:
    1) If --doc-id is provided, select that exact artifact.
    2) Else if exactly one artifact matches filters, select it.
    3) Else if --latest is set, pick the most recently updated artifact.
    4) Else return an ambiguity error with candidate artifacts.

Examples:
    $SCRIPT_NAME --issue 42 --artifact-type implementation-plan --latest --format doc-id
    $SCRIPT_NAME --issue 42 --doc-id "dv1:workinprogress-ai-devenv:issue-42:implementation-plan:implementation-plan-issue-42-001" --format url
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

    ensure_gh_login

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
                ISSUE_NUMBER="${2:-}"
                shift 2
                ;;
            --artifact-type|--artifact_type)
                require_option_value "$1" "${2:-}"
                ARTIFACT_TYPE="${2:-}"
                shift 2
                ;;
            --doc-id|--doc_id)
                require_option_value "$1" "${2:-}"
                DOC_ID="${2:-}"
                shift 2
                ;;
            --latest)
                SELECT_LATEST=1
                shift
                ;;
            -f|--format)
                require_option_value "$1" "${2:-}"
                OUTPUT_FORMAT="${2:-}"
                shift 2
                ;;
            --pretty)
                PRETTY=1
                shift
                ;;
            --repo)
                require_option_value "$1" "${2:-}"
                REPO_OVERRIDE="${2:-}"
                shift 2
                ;;
            *)
                invalid_args "Unknown option: $1"
                ;;
        esac
    done

    if [ -z "$ISSUE_NUMBER" ]; then
        invalid_args "issue_number is required (--issue or --issue-number)"
    fi

    if ! validate_issue_number "$ISSUE_NUMBER"; then
        exit 2
    fi

    case "$OUTPUT_FORMAT" in
        json|doc-id|comment-id|url)
            ;;
        *)
            invalid_args "Invalid format: $OUTPUT_FORMAT (use json|doc-id|comment-id|url)"
            ;;
    esac

    local list_args=(--issue "$ISSUE_NUMBER")
    if [ -n "$ARTIFACT_TYPE" ]; then
        list_args+=(--artifact-type "$ARTIFACT_TYPE")
    fi
    if [ -n "$REPO_OVERRIDE" ]; then
        list_args+=(--repo "$REPO_OVERRIDE")
    fi

    log_verbose "Listing candidate artifacts for issue #$ISSUE_NUMBER"
    local artifacts
    if ! artifacts=$(issue-artifact-list "${list_args[@]}"); then
        log_error "Failed to list artifacts"
        exit 4
    fi

    local selected
    if [ -n "$DOC_ID" ]; then
        selected=$(echo "$artifacts" | jq --arg doc_id "$DOC_ID" '[ .[] | select(.doc_id == $doc_id) ]')
        local doc_count
        doc_count=$(echo "$selected" | jq 'length')
        if [ "$doc_count" -eq 0 ]; then
            log_error "No artifact found for doc_id: $DOC_ID"
            exit 1
        fi
        if [ "$doc_count" -gt 1 ]; then
            jq -n --arg action "conflict" --argjson issue_number "$ISSUE_NUMBER" --arg doc_id "$DOC_ID" --argjson matches "$(echo "$selected" | jq '[.[].comment_id]')" '{action:$action, issue_number:$issue_number, doc_id:$doc_id, matches:$matches}'
            exit 3
        fi
        selected=$(echo "$selected" | jq '.[0]')
    else
        local count
        count=$(echo "$artifacts" | jq 'length')
        if [ "$count" -eq 0 ]; then
            log_error "No artifacts matched the requested filters"
            exit 1
        fi
        if [ "$count" -eq 1 ]; then
            selected=$(echo "$artifacts" | jq '.[0]')
        elif [ "$SELECT_LATEST" -eq 1 ]; then
            selected=$(echo "$artifacts" | jq '.[0]')
        else
            jq -n --arg action "ambiguous" --argjson issue_number "$ISSUE_NUMBER" --arg artifact_type "$ARTIFACT_TYPE" --argjson matches "$(echo "$artifacts" | jq '[.[] | {comment_id, doc_id, artifact_type, title, updatedAt, url}]')" '{action:$action, issue_number:$issue_number, artifact_type:($artifact_type|select(. != "")), matches:$matches}'
            exit 5
        fi
    fi

    case "$OUTPUT_FORMAT" in
        doc-id)
            echo "$selected" | jq -r '.doc_id'
            ;;
        comment-id)
            echo "$selected" | jq -r '.comment_id'
            ;;
        url)
            echo "$selected" | jq -r '.url'
            ;;
        json)
            if [ "$PRETTY" -eq 1 ]; then
                echo "$selected" | jq .
            else
                echo "$selected"
            fi
            ;;
    esac
}

main "$@"
