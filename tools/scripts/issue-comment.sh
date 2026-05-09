#!/bin/bash
# issue-comment.sh - Add a comment to a GitHub issue
# Version: 1.0.0
# Description: Posts a comment to a GitHub issue from text, file, or interactive editor
# Requirements: Bash 4.0+, gh CLI
# Author: WorkInProgress.ai
# Last Modified: 2026-05-08

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Add a comment to a GitHub issue"

# ============================================================================
# Global Variables
# ============================================================================

ISSUE_NUMBER=""
COMMENT_BODY=""
COMMENT_FILE=""
USE_EDITOR=0
DRY_RUN=0
VERBOSE=0
ALLOW_DEVENV_REPO=0
TEMP_FILE=""

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME ISSUE_NUMBER [OPTIONS]

Add a comment to a GitHub issue.

Arguments:
    ISSUE_NUMBER                Issue number to comment on

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without posting
    --devenv                    Safety override to comment on devenv repo issues

Comment Source (one required):
    -b, --body TEXT             Comment text (inline)
    -f, --body-file FILE        Read comment from file (markdown)
    -e, --edit                  Open \$EDITOR to compose comment

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)

Examples:
    # Inline comment
    $SCRIPT_NAME 123 --body "Fixed in PR #456"

    # Comment from a markdown file
    $SCRIPT_NAME 123 --body-file notes.md

    # Compose in editor
    $SCRIPT_NAME 123 --edit

    # Dry-run (shows what would be posted)
    $SCRIPT_NAME 123 --body "Test comment" --dry-run

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

cleanup() {
    if [ -n "$TEMP_FILE" ] && [ -f "$TEMP_FILE" ]; then
        rm -f "$TEMP_FILE"
        log_verbose "Cleaned up temp file: $TEMP_FILE"
    fi
}
trap cleanup EXIT

# Open editor to compose the comment body
compose_in_editor() {
    TEMP_FILE=$(mktemp /tmp/gh-comment.XXXXXX.md)
    local editor="${EDITOR:-nano}"
    log_verbose "Opening editor: $editor"

    if ! "$editor" "$TEMP_FILE"; then
        log_error "Editor exited with error"
        exit 1
    fi

    COMMENT_BODY=$(cat "$TEMP_FILE")

    if [ -z "$(echo "$COMMENT_BODY" | tr -d '[:space:]')" ]; then
        log_error "Comment body is empty — aborting"
        exit 1
    fi
}

# Post the comment
post_comment() {
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"

    if [ "$DRY_RUN" -eq 1 ]; then
        log_info "[DRY RUN] Would post comment on issue #$ISSUE_NUMBER:"
        echo "$COMMENT_BODY"
        return 0
    fi

    local gh_args=()
    gh_args+=("${repo_spec[@]}")

    if [ -n "$COMMENT_FILE" ]; then
        gh_args+=(--body-file "$COMMENT_FILE")
    else
        gh_args+=(--body "$COMMENT_BODY")
    fi

    log_verbose "Posting comment on issue #$ISSUE_NUMBER"

    if gh issue comment "${gh_args[@]}" "$ISSUE_NUMBER"; then
        log_info "Comment posted on issue #$ISSUE_NUMBER"
    else
        log_error "Failed to post comment on issue #$ISSUE_NUMBER"
        exit 1
    fi
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
            -n|--dry-run)
                DRY_RUN=1
                shift
                ;;
            -b|--body)
                COMMENT_BODY="$2"
                shift 2
                ;;
            -f|--body-file)
                if [ ! -f "$2" ]; then
                    log_error "File not found: $2"
                    exit 1
                fi
                COMMENT_FILE="$2"
                shift 2
                ;;
            -e|--edit)
                USE_EDITOR=1
                shift
                ;;
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
                ALLOW_DEVENV_REPO=1
                shift
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

    # Exactly one comment source must be provided
    local sources=0
    [ -n "$COMMENT_BODY" ] && sources=$((sources + 1))
    [ -n "$COMMENT_FILE" ] && sources=$((sources + 1))
    [ "$USE_EDITOR" -eq 1 ] && sources=$((sources + 1))

    if [ "$sources" -eq 0 ]; then
        log_error "A comment source is required: --body, --body-file, or --edit"
        echo "Use --help for usage information"
        exit 1
    fi

    if [ "$sources" -gt 1 ]; then
        log_error "Only one of --body, --body-file, or --edit may be specified"
        echo "Use --help for usage information"
        exit 1
    fi

    check_target_repo

    # Compose via editor if requested (populates COMMENT_BODY)
    if [ "$USE_EDITOR" -eq 1 ]; then
        compose_in_editor
    fi

    post_comment
}

main "$@"
