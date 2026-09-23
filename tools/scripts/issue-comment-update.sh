#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# issue-comment-update.sh - Replace the body of an existing GitHub issue comment
# Version: 1.0.0
# Description: Updates a comment identified by its numeric ID (as returned by
#              issue-comment-list).  Supports inline text, a file, and --dry-run.
# Requirements: Bash 4.0+, gh CLI, jq

set -euo pipefail
# shellcheck disable=SC2034  # VERBOSE is written here; read by log_verbose in error-handling.bash

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/provider-loader.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"
source "$DEVENV_TOOLS/lib/body-source.bash"

readonly SCRIPT_VERSION="1.1.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Replace the body of an existing GitHub issue comment"

# ============================================================================
# Global Variables
# ============================================================================

COMMENT_ID=""
COMMENT_BODY=""
COMMENT_FILE=""
DRY_RUN=0
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
VERBOSE=0
ALLOW_DEVENV_REPO=0

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME COMMENT_ID [OPTIONS]

Replace the body of an existing GitHub issue comment.  COMMENT_ID is the
numeric ID returned by issue-comment-list — it is NOT the issue number.

The comment is validated (GET) before the update is attempted; if the ID does
not exist the tool exits cleanly with an error.

Arguments:
    COMMENT_ID                  Numeric comment ID to update

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be sent without calling the API
    --devenv                    Safety override to update comments in devenv repo
    --repo OWNER/REPO           Override the target repository

Comment Source (one required):
    -b, --body TEXT             New comment text (inline)
    -f, --body-file FILE        Read new comment body from file (markdown; '-'
                                reads stdin; piped stdin with no flag is auto-read)

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)

Examples:
    # Replace a comment body inline
    $SCRIPT_NAME 12345678 --body "Updated content"

    # Replace from a markdown file
    $SCRIPT_NAME 12345678 --body-file spike-001-results.md

    # Dry-run to preview what would be sent
    $SCRIPT_NAME 12345678 --body-file spike-001-results.md --dry-run

    # Explicit repo
    $SCRIPT_NAME 12345678 --body-file notes.md --repo org/repo

EOF
    exit 0
}

# Validate that the comment exists.  Exits on 404.
validate_comment_exists() {
    log_verbose "Checking comment $COMMENT_ID exists"
    check_issue_comment_exists "$COMMENT_ID" || exit "$EXIT_GENERAL_ERROR"
}

# Replace the comment body
update_comment() {
    local body
    if [ -n "$COMMENT_FILE" ]; then
        if [ "$COMMENT_FILE" = "-" ]; then
            if body_source_stdin_is_tty; then
                log_error "--body-file - requires piped stdin (refusing to read the terminal)"
                exit "$EXIT_GENERAL_ERROR"
            fi
            body=$(cat)
            if [ -z "$(printf '%s' "$body" | tr -d '[:space:]')" ]; then
                log_error "Refusing empty stdin body (pipe content or use --body/--body-file)"
                exit "$EXIT_GENERAL_ERROR"
            fi
        else
            body=$(cat "$COMMENT_FILE")
        fi
    else
        body="$COMMENT_BODY"
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        log_info "[DRY RUN] Would PATCH comment $COMMENT_ID with body:"
        echo "$body"
        return 0
    fi

    log_verbose "Updating comment $COMMENT_ID"

    if ! update_issue_comment "$COMMENT_ID" "$body"; then
        exit "$EXIT_GENERAL_ERROR"
    fi

    log_info "Comment $COMMENT_ID updated"
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    if [ $# -eq 0 ]; then
        log_error "Comment ID is required"
        echo "Use --help for usage information"
        exit $EXIT_MISUSE
    fi


    # Global flags before auth/validation: --help must work without
    # a valid GitHub session or any positional args.
    if handle_global_flag "${1:-}"; then
        exit 0
    fi

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
                # shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
                VERBOSE=1
                shift
                ;;
            -n|--dry-run)
                DRY_RUN=1
                shift
                ;;
            -b|--body)
                require_option_value "-b" "${2:-}"
                COMMENT_BODY="$2"
                shift 2
                ;;
            -f|--body-file)
                require_option_value "-f" "${2:-}"
                if [ "$2" = "-" ]; then
                    COMMENT_FILE="-"
                elif [ ! -f "$2" ]; then
                    log_error "File not found: $2"
                    exit $EXIT_API_FAILURE
                else
                    COMMENT_FILE="$2"
                fi
                shift 2
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
                exit $EXIT_MISUSE
                ;;
            *)
                if [ -z "$COMMENT_ID" ]; then
                    if ! validate_comment_id "$1"; then
                        exit "$EXIT_GENERAL_ERROR"
                    fi
                    COMMENT_ID="$1"
                else
                    log_error "Unexpected argument: $1"
                    echo "Use --help for usage information"
                    exit $EXIT_MISUSE
                fi
                shift
                ;;
        esac
    done

    if [ -z "$COMMENT_ID" ]; then
        log_error "Comment ID is required"
        echo "Use --help for usage information"
        exit $EXIT_MISUSE
    fi

    local sources=0
    [ -n "$COMMENT_BODY" ] && sources=$((sources + 1))
    [ -n "$COMMENT_FILE" ] && sources=$((sources + 1))

    if [ "$sources" -gt 1 ]; then
        log_error "Only one of --body or --body-file may be specified"
        echo "Use --help for usage information"
        exit $EXIT_MISUSE
    fi

    if [ "$sources" -eq 0 ]; then
        # No explicit source: piped stdin auto-reads (shared body-source
        # contract); empty/closed stdin is a hard error.
        if ! body_source_stdin_is_tty; then
            local resolved
            if ! resolved=$(body_source_resolve ""); then
                echo "Use --help for usage information"
                exit $EXIT_MISUSE
            fi
            COMMENT_BODY="$resolved"
            log_verbose "No source flag; body read from piped stdin"
        else
            log_error "A comment source is required: --body or --body-file"
            echo "Use --help for usage information"
            exit $EXIT_MISUSE
        fi
    fi

    check_target_repo

    # Skip the existence check during dry-run — no network needed
    [ "$DRY_RUN" -eq 0 ] && validate_comment_exists

    update_comment
}

main "$@"
