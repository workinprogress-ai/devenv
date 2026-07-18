#!/bin/bash
# issue-artifact-upsert.sh - Deterministically create/update an issue comment by doc_id
# Version: 1.0.0
# Description: Upserts an issue comment by matching the exact metadata line
#              "doc_id: <doc_id>" within the first 256 characters.
# Requirements: Bash 4.0+, gh CLI, jq

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Deterministically upsert a GitHub issue comment by doc_id"

ISSUE_NUMBER=""
COMMENT_BODY=""
COMMENT_FILE=""
REPO_OVERRIDE=""
DRY_RUN=0
VERBOSE=0

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

Create or update a GitHub issue comment by stable doc_id marker.

Required Inputs:
    --issue, --issue-number N     Issue number

Comment Source (exactly one required):
    -b, --body TEXT               Comment body text
    -f, --body-file FILE          Read comment body from file (doc_id extracted from DEVENV_ARTIFACT_V1 header)

Options:
    -n, --dry-run                 Resolve intended action without writing
    --repo OWNER/REPO             Repository override (defaults to GITHUB_REPO)
    -V, --verbose                 Enable verbose logs
    -h, --help                    Show this help and exit
    -v, --version                 Show version and exit

Behavior:
    1) Read comment body from --body or --body-file
    2) Extract doc_id from "doc_id: <ID>" line in first 256 characters
    3) Search all issue comments for matching doc_id in first 256 characters
    4) 1 match   -> update comment
    5) 0 matches -> create new comment
    6) >1 match  -> conflict (exit 3)

Output JSON:
    Success: {"action":"created|updated","issue_number":N,"comment_id":ID,"comment_url":"..."}
    Conflict: {"action":"conflict","issue_number":N,"matches":[ID, ...]}

Exit Codes:
    0 success (created/updated)
    2 invalid arguments
    3 duplicate doc_id conflict
    4 API/tool failure

Examples:
    $SCRIPT_NAME --issue 42 --body-file artifact.md
    $SCRIPT_NAME --issue-number 56 --body "doc_id: dv1:...\n..." --dry-run
EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
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

api_failure() {
    log_error "$1"
    exit 4
}

load_comment_body() {
    if [ -n "$COMMENT_FILE" ]; then
        if [ ! -f "$COMMENT_FILE" ]; then
            invalid_args "File not found: $COMMENT_FILE"
        fi
        cat "$COMMENT_FILE"
        return
    fi

    echo "$COMMENT_BODY"
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
            -n|--dry-run)
                DRY_RUN=1
                shift
                ;;
            --issue|--issue-number|--issue_number)
                require_option_value "$1" "${2:-}"
                ISSUE_NUMBER="${2:-}"
                shift 2
                ;;
            -b|--body)
                require_option_value "$1" "${2:-}"
                COMMENT_BODY="${2:-}"
                shift 2
                ;;
            -f|--body-file|--body_file)
                require_option_value "$1" "${2:-}"
                COMMENT_FILE="${2:-}"
                shift 2
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

    local sources=0
    [ -n "$COMMENT_BODY" ] && sources=$((sources + 1))
    [ -n "$COMMENT_FILE" ] && sources=$((sources + 1))

    if [ "$sources" -eq 0 ]; then
        invalid_args "One comment source is required: --body or --body-file"
    fi

    if [ "$sources" -gt 1 ]; then
        invalid_args "Only one of --body or --body-file may be specified"
    fi

    if [ -n "$REPO_OVERRIDE" ]; then
        GITHUB_REPO="$REPO_OVERRIDE"
    fi

    local repo_args=()
    if [ -n "${GITHUB_REPO:-}" ]; then
        repo_args=(-R "$GITHUB_REPO")
    fi

    local body
    body="$(load_comment_body)"

    # Extract doc_id from body header (first 256 chars)
    local body_prefix
    body_prefix="${body:0:256}"
    local doc_id
    doc_id=$(printf '%s\n' "$body_prefix" | grep -oP '^doc_id: \K.*' | head -1)
    if [ -z "$doc_id" ]; then
        invalid_args "Comment body must include 'doc_id: <value>' in first 256 characters"
    fi
    log_verbose "Extracted doc_id from body: $doc_id"

    if [[ "$doc_id" == *$'\n'* ]]; then
        invalid_args "doc_id must be a single line"
    fi

    local expected_doc_line="doc_id: $doc_id"
    if ! printf '%s\n' "$body_prefix" | grep -Fxq "$expected_doc_line"; then
        invalid_args "doc_id metadata line must appear within first 256 characters"
    fi

    log_verbose "Fetching comments for issue #$ISSUE_NUMBER"
    local comments_raw
    if ! comments_raw=$(gh api "${repo_args[@]}" "repos/{owner}/{repo}/issues/${ISSUE_NUMBER}/comments" --paginate 2>/dev/null); then
        api_failure "Failed to fetch comments for issue #$ISSUE_NUMBER"
    fi

    local matches
    if ! matches=$(echo "$comments_raw" | jq --arg line "$expected_doc_line" '
        [ .[]
          | select(((.body // "")[0:256] | split("\n") | any(. == $line)))
          | {id: .id, url: .html_url}
        ]
    ' 2>/dev/null); then
        api_failure "Failed to parse issue comments"
    fi

    local match_count
    match_count=$(echo "$matches" | jq 'length')

    if [ "$match_count" -gt 1 ]; then
        local conflict_ids
        conflict_ids=$(echo "$matches" | jq '[.[].id]')
        jq -n \
            --arg action "conflict" \
            --argjson issue_number "$ISSUE_NUMBER" \
            --argjson matches "$conflict_ids" \
            '{action: $action, issue_number: $issue_number, matches: $matches}'
        exit 3
    fi

    if [ "$match_count" -eq 1 ]; then
        local comment_id
        local comment_url
        comment_id=$(echo "$matches" | jq '.[0].id')
        comment_url=$(echo "$matches" | jq -r '.[0].url')

        if [ "$DRY_RUN" -eq 1 ]; then
            jq -n \
                --arg action "updated" \
                --argjson issue_number "$ISSUE_NUMBER" \
                --argjson comment_id "$comment_id" \
                --arg comment_url "$comment_url" \
                '{action: $action, issue_number: $issue_number, comment_id: $comment_id, comment_url: $comment_url}'
            exit 0
        fi

        log_verbose "Updating comment ID $comment_id"
        local updated
        if ! updated=$(gh api "${repo_args[@]}" \
            "repos/{owner}/{repo}/issues/comments/${comment_id}" \
            -X PATCH \
            -f "body=${body}" 2>/dev/null); then
            api_failure "Failed to update comment ID $comment_id"
        fi

        local out_id
        local out_url
        out_id=$(echo "$updated" | jq '.id')
        out_url=$(echo "$updated" | jq -r '.html_url')

        jq -n \
            --arg action "updated" \
            --argjson issue_number "$ISSUE_NUMBER" \
            --argjson comment_id "$out_id" \
            --arg comment_url "$out_url" \
            '{action: $action, issue_number: $issue_number, comment_id: $comment_id, comment_url: $comment_url}'
        exit 0
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        jq -n \
            --arg action "created" \
            --argjson issue_number "$ISSUE_NUMBER" \
            '{action: $action, issue_number: $issue_number}'
        exit 0
    fi

    log_verbose "Creating new comment on issue #$ISSUE_NUMBER"
    local created
    if ! created=$(gh api "${repo_args[@]}" \
        "repos/{owner}/{repo}/issues/${ISSUE_NUMBER}/comments" \
        -X POST \
        -f "body=${body}" 2>/dev/null); then
        api_failure "Failed to create issue comment on issue #$ISSUE_NUMBER"
    fi

    local created_id
    local created_url
    created_id=$(echo "$created" | jq '.id')
    created_url=$(echo "$created" | jq -r '.html_url')

    jq -n \
        --arg action "created" \
        --argjson issue_number "$ISSUE_NUMBER" \
        --argjson comment_id "$created_id" \
        --arg comment_url "$created_url" \
        '{action: $action, issue_number: $issue_number, comment_id: $comment_id, comment_url: $comment_url}'
}

main "$@"
