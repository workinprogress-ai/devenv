#!/bin/bash
# issue-comment-list.sh - List all comments on a GitHub issue with their IDs
# Version: 1.0.0
# Description: Returns each comment's numeric ID, author, timestamps, URL, and
#              a body preview — suitable for scripting and AI tooling.
# Requirements: Bash 4.0+, gh CLI, jq

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "List all comments on a GitHub issue with their IDs"

# ============================================================================
# Global Variables
# ============================================================================

ISSUE_NUMBER=""
OUTPUT_FORMAT="lines"   # lines (one JSON object per line) | pretty (JSON array)
FULL_BODY=0
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME ISSUE_NUMBER [OPTIONS]

List all comments on a GitHub issue, including each comment's numeric ID and a
body preview.  The numeric IDs can be passed to issue-comment-update to replace
a comment's body.

Arguments:
    ISSUE_NUMBER                Issue number to list comments for

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    --pretty                    Pretty-print as a JSON array (default: one object per line)
    --full                      Return complete body as "body" field instead of the
                                256-character "bodyPreview" truncation
    --devenv                    Safety override to read issues in devenv repo
    --repo OWNER/REPO           Override the target repository

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)

Output Fields (per comment):
    id           Numeric comment ID (use with issue-comment-update)
    author       Login of the comment author
    createdAt    ISO 8601 creation timestamp
    updatedAt    ISO 8601 last-updated timestamp
    bodyPreview  First 256 characters of the comment body (omitted when --full is set)
    body         Complete comment body (only present when --full is set)
    url          Direct link to the comment

Examples:
    # List all comments on issue 42
    $SCRIPT_NAME 42

    # Pretty-printed JSON array
    $SCRIPT_NAME 42 --pretty

    # Extract just the IDs and previews
    $SCRIPT_NAME 42 | jq -r '[.id, .bodyPreview] | @tsv'

    # Find the comment whose preview mentions "spike"
    $SCRIPT_NAME 42 | jq -r 'select(.bodyPreview | test("spike"; "i")) | .id'

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

# Fetch comments and emit them
list_comments() {
    log_verbose "Fetching comments for issue #$ISSUE_NUMBER"

    local raw
    raw=$(fetch_issue_comments "$ISSUE_NUMBER") || exit 1

    local fmt_args=()
    [ "$OUTPUT_FORMAT" = "pretty" ] && fmt_args+=(--pretty)
    [ "$FULL_BODY" -eq 1 ]         && fmt_args+=(--full)

    format_issue_comments "$raw" "${fmt_args[@]}"
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    if [ $# -eq 0 ]; then
        log_error "Issue number is required"
        echo "Use --help for usage information"
        exit 1
    fi

    case "$1" in
        -h|--help)    show_usage ;;
        -v|--version) echo "$SCRIPT_VERSION"; exit 0 ;;
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
            --pretty)
                OUTPUT_FORMAT="pretty"
                shift
                ;;
            --full)
                FULL_BODY=1
                shift
                ;;
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
                ALLOW_DEVENV_REPO=1
                shift
                ;;
            --repo)
                # shellcheck disable=SC2034  # Read by library functions via ${GITHUB_REPO:-}
                GITHUB_REPO="$2"
                shift 2
                ;;
            -*)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
            *)
                if [ -z "$ISSUE_NUMBER" ]; then
                    if ! validate_issue_number "$1"; then
                        log_error "Invalid issue number: $1"
                        exit 1
                    fi
                    ISSUE_NUMBER="$1"
                else
                    log_error "Unexpected argument: $1"
                    echo "Use --help for usage information"
                    exit 1
                fi
                shift
                ;;
        esac
    done

    if [ -z "$ISSUE_NUMBER" ]; then
        log_error "Issue number is required"
        echo "Use --help for usage information"
        exit 1
    fi

    check_target_repo
    list_comments
}

main "$@"
