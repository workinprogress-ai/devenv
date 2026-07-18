#!/bin/bash
# issue-artifact-get.sh - Retrieve a deterministic issue-comment artifact by doc_id
# Version: 1.0.0
# Description: Fetches exactly one issue comment artifact matched by doc_id metadata line.
# Requirements: Bash 4.0+, gh CLI, jq

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Retrieve an issue artifact comment by deterministic doc_id"

ISSUE_NUMBER=""
DOC_ID=""
REPO_OVERRIDE=""
OUTPUT_FORMAT="json"   # json | pretty
FULL_BODY=0
VERBOSE=0

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

Retrieve a single issue-comment artifact by deterministic doc_id.

Required Inputs:
    --issue, --issue-number N     Issue number
    --doc-id ID                   Artifact doc_id to resolve

Options:
    --full                        Return full body as "body" (default: bodyPreview only)
    --pretty                      Pretty-print JSON output
    --repo OWNER/REPO             Repository override (defaults to GITHUB_REPO)
    -V, --verbose                 Enable verbose logs
    -h, --help                    Show help and exit
    -v, --version                 Show version and exit

Output:
    {
      "issue_number": 42,
      "doc_id": "dv1:...",
      "comment_id": 123456,
      "artifact_type": "implementation-plan",
      "author": "octocat",
      "createdAt": "...",
      "updatedAt": "...",
      "url": "...",
      "bodyPreview": "..." | "body": "..."
    }

Exit Codes:
    0 success
    1 not found
    2 invalid arguments
    3 duplicate doc_id conflict
    4 API/tool failure
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

api_failure() {
    log_error "$1"
    exit 4
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
            --full)
                FULL_BODY=1
                shift
                ;;
            --pretty)
                OUTPUT_FORMAT="pretty"
                shift
                ;;
            --issue|--issue-number|--issue_number)
                require_option_value "$1" "${2:-}"
                ISSUE_NUMBER="${2:-}"
                shift 2
                ;;
            --doc-id|--doc_id)
                require_option_value "$1" "${2:-}"
                DOC_ID="${2:-}"
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

    if [ -z "$DOC_ID" ]; then
        invalid_args "doc_id is required (--doc-id)"
    fi

    if [ -n "$REPO_OVERRIDE" ]; then
        GITHUB_REPO="$REPO_OVERRIDE"
    fi

    local repo_args=()
    if [ -n "${GITHUB_REPO:-}" ]; then
        repo_args=(-R "$GITHUB_REPO")
    fi

    local comments_raw
    log_verbose "Fetching comments for issue #$ISSUE_NUMBER"
    if ! comments_raw=$(gh api "${repo_args[@]}" "repos/{owner}/{repo}/issues/${ISSUE_NUMBER}/comments" --paginate 2>/dev/null); then
        api_failure "Failed to fetch comments for issue #$ISSUE_NUMBER"
    fi

    local artifact_matches
    if ! artifact_matches=$(echo "$comments_raw" | jq --arg doc_id "$DOC_ID" '
        [ .[]
          | . as $c
          | (($c.body // "")[0:256] | split("\n")) as $meta
          | ($meta | map(select(startswith("doc_id: ")) | sub("^doc_id: "; "")) | .[0] // "") as $found_doc_id
          | select($found_doc_id == $doc_id)
          | {
              issue_number: ($c.issue_url | capture(".*/issues/(?<n>[0-9]+)$").n | tonumber),
              doc_id: $found_doc_id,
              comment_id: $c.id,
              artifact_type: (($meta | map(select(startswith("artifact_type: ")) | sub("^artifact_type: "; "")) | .[0]) // null),
              author: ($c.user.login // null),
              createdAt: $c.created_at,
              updatedAt: $c.updated_at,
              url: $c.html_url,
              bodyPreview: (($c.body // "") | .[0:256]),
              body: ($c.body // "")
            }
        ]' 2>/dev/null); then
        api_failure "Failed to parse issue comments"
    fi

    local match_count
    match_count=$(echo "$artifact_matches" | jq 'length')

    if [ "$match_count" -eq 0 ]; then
        log_error "No artifact comment found for doc_id: $DOC_ID"
        exit 1
    fi

    if [ "$match_count" -gt 1 ]; then
        local conflict_ids
        conflict_ids=$(echo "$artifact_matches" | jq '[.[].comment_id]')
        jq -n \
            --arg action "conflict" \
            --argjson issue_number "$ISSUE_NUMBER" \
            --arg doc_id "$DOC_ID" \
            --argjson matches "$conflict_ids" \
            '{action: $action, issue_number: $issue_number, doc_id: $doc_id, matches: $matches}'
        exit 3
    fi

    local result
    if [ "$FULL_BODY" -eq 1 ]; then
        result=$(echo "$artifact_matches" | jq '.[0] | del(.bodyPreview)')
    else
        result=$(echo "$artifact_matches" | jq '.[0] | del(.body)')
    fi

    if [ "$OUTPUT_FORMAT" = "pretty" ]; then
        echo "$result" | jq .
    else
        echo "$result"
    fi
}

main "$@"
