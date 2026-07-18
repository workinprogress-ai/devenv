#!/bin/bash
# issue-artifact-list.sh - List issue-comment artifacts with metadata extracted from headers
# Version: 1.0.0
# Description: Lists deterministic artifacts published to issue comments.
# Requirements: Bash 4.0+, gh CLI, jq

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "List issue-comment artifacts by metadata"

ISSUE_NUMBER=""
ARTIFACT_TYPE=""
REPO_OVERRIDE=""
OUTPUT_FORMAT="json"   # json | pretty
FULL_BODY=0
VERBOSE=0

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

List issue-comment artifacts that include DEVENV metadata headers.

Required Inputs:
    --issue, --issue-number N     Issue number

Optional Filters:
    --artifact-type TYPE          Filter by artifact type (for example: implementation-plan)

Options:
    --full                        Return full body as "body" (default: bodyPreview only)
    --pretty                      Pretty-print JSON output
    --repo OWNER/REPO             Repository override (defaults to GITHUB_REPO)
    -V, --verbose                 Enable verbose logs
    -h, --help                    Show help and exit
    -v, --version                 Show version and exit

Output:
    [
      {
        "issue_number": 42,
        "comment_id": 123456,
        "doc_id": "dv1:...",
        "artifact_type": "implementation-plan",
        "source_file": "repos/foo/Implementation_plan-issue-42-001.md",
        "title": "Plan title",
        "updatedAt": "...",
        "url": "...",
        "bodyPreview": "..."
      }
    ]

Exit Codes:
    0 success
    2 invalid arguments
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
            --artifact-type|--artifact_type)
                require_option_value "$1" "${2:-}"
                ARTIFACT_TYPE="${2:-}"
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

    local results
    if ! results=$(echo "$comments_raw" | jq --arg artifact_type "$ARTIFACT_TYPE" '
        [ .[]
          | . as $c
          | ($c.body // "") as $body
          | ($body[0:256] | split("\n")) as $meta
          | ($meta | map(select(startswith("doc_id: ")) | sub("^doc_id: "; "")) | .[0] // "") as $doc_id
          | ($meta | map(select(startswith("artifact_type: ")) | sub("^artifact_type: "; "")) | .[0] // "") as $found_type
          | ($meta | map(select(startswith("source_file: ")) | sub("^source_file: "; "")) | .[0] // null) as $source_file
          | select($doc_id != "")
          | select($artifact_type == "" or $found_type == $artifact_type)
          | {
              issue_number: ($c.issue_url | capture(".*/issues/(?<n>[0-9]+)$").n | tonumber),
              comment_id: $c.id,
              doc_id: $doc_id,
              artifact_type: ($found_type // null),
              source_file: $source_file,
              title: (($body | split("\n") | map(select(startswith("# "))) | .[0] // null) | if . == null then null else sub("^# "; "") end),
              author: ($c.user.login // null),
              createdAt: $c.created_at,
              updatedAt: $c.updated_at,
              url: $c.html_url,
              bodyPreview: ($body | .[0:256]),
              body: $body
            }
        ]
        | sort_by(.updatedAt) | reverse' 2>/dev/null); then
        api_failure "Failed to parse issue comments"
    fi

    if [ "$FULL_BODY" -eq 1 ]; then
        :
    else
        results=$(echo "$results" | jq 'map(del(.body))')
    fi

    if [ "$FULL_BODY" -eq 1 ]; then
        results=$(echo "$results" | jq 'map(del(.bodyPreview))')
    fi

    if [ "$OUTPUT_FORMAT" = "pretty" ]; then
        echo "$results" | jq .
    else
        echo "$results"
    fi
}

main "$@"
