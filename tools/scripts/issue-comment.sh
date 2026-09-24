#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# issue-comment.sh - Add a comment to a GitHub issue
# Version: 1.0.0
# Description: Posts a comment to a GitHub issue from text, file, or interactive editor
# Requirements: Bash 4.0+, gh CLI
# Author: WorkInProgress.ai
# Last Modified: 2026-05-08

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
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Add a comment to a GitHub issue"

# ============================================================================
# Global Variables
# ============================================================================

ISSUE_NUMBER=""
COMMENT_BODY=""
COMMENT_FILE=""
USE_EDITOR=0
DRY_RUN=0
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
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
    -f, --body-file FILE        Read comment from file (markdown; '-' reads stdin;
                                piped stdin with no flag is auto-read)
    -e, --edit                  Open \$EDITOR to compose comment

Environment Variables:
    DEVENV_REPO                 Repository in format owner/repo (default: current repo)

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
        exit "$EXIT_GENERAL_ERROR"
    fi

    COMMENT_BODY=$(cat "$TEMP_FILE")

    if [ -z "$(echo "$COMMENT_BODY" | tr -d '[:space:]')" ]; then
        log_error "Comment body is empty — aborting"
        exit "$EXIT_GENERAL_ERROR"
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

    local comment_args=()
    if [ -n "$COMMENT_FILE" ]; then
        comment_args+=(--body-file "$COMMENT_FILE")
    else
        comment_args+=(--body "$COMMENT_BODY")
    fi

    log_verbose "Posting comment on issue #$ISSUE_NUMBER"

    # The facade verb's signature is provider_issues_comment [repo] NUMBER
    # [flags...]: repo positionally (or empty for cwd resolution), then the
    # issue number. Passing the prebuilt "-R repo --body ..." array with its
    # first element duplicated into the repo slot scrambled the argument
    # stream into invalid gh invocations in both the with-repo and no-repo
    # shapes. get_repo_spec emits "-R owner/repo"; strip the flag word.
    local repo="${repo_spec[1]:-}"
    if [ "${repo_spec[0]:-}" != "-R" ]; then
        repo=""
    fi

    if provider_issues_comment "$repo" "$ISSUE_NUMBER" "${comment_args[@]}"; then
        log_info "Comment posted on issue #$ISSUE_NUMBER"
    else
        log_error "Failed to post comment on issue #$ISSUE_NUMBER"
        exit $EXIT_API_FAILURE
    fi
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    if [ $# -eq 0 ]; then
        log_error "Issue number is required"
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
                exit $EXIT_MISUSE
                ;;
            *)
                if [ -z "$ISSUE_NUMBER" ]; then
                    if ! validate_issue_number "$1"; then
                        log_error "Invalid issue number: $1"
                        exit $EXIT_MISUSE
                    fi
                    ISSUE_NUMBER="$1"
                else
                    log_error "Unexpected argument: $1"
                    echo "Use --help for usage information"
                    exit $EXIT_MISUSE
                fi
                shift
                ;;
        esac
    done

    if [ -z "$ISSUE_NUMBER" ]; then
        log_error "Issue number is required"
        echo "Use --help for usage information"
        exit $EXIT_MISUSE
    fi

    # Exactly one comment source must be provided
    local sources=0
    [ -n "$COMMENT_BODY" ] && sources=$((sources + 1))
    [ -n "$COMMENT_FILE" ] && sources=$((sources + 1))
    [ "$USE_EDITOR" -eq 1 ] && sources=$((sources + 1))

    if [ "$sources" -gt 1 ]; then
        log_error "Only one of --body, --body-file, or --edit may be specified"
        echo "Use --help for usage information"
        exit $EXIT_MISUSE
    fi

    if [ "$sources" -eq 0 ]; then
        # No explicit source: piped stdin auto-reads (shared body-source
        # contract); a TTY is a real interactive session, so require a flag.
        if ! body_source_stdin_is_tty; then
            local resolved
            if ! resolved=$(body_source_resolve ""); then
                echo "Use --help for usage information"
                exit $EXIT_MISUSE
            fi
            COMMENT_BODY="$resolved"
            COMMENT_FILE=""   # body is already resolved; post via --body
            log_verbose "No source flag; comment read from piped stdin"
        else
            log_error "A comment source is required: --body, --body-file, or --edit"
            echo "Use --help for usage information"
            exit $EXIT_MISUSE
        fi
    fi

    check_target_repo

    # Compose via editor if requested (populates COMMENT_BODY)
    if [ "$USE_EDITOR" -eq 1 ]; then
        compose_in_editor
    fi

    # Materialize `-` (stdin) into COMMENT_BODY before posting so both the
    # dry-run preview and the real post show the same content.
    if [ "$COMMENT_FILE" = "-" ]; then
        if body_source_stdin_is_tty; then
            log_error "--body-file - requires piped stdin (refusing to read the terminal)"
            exit "$EXIT_GENERAL_ERROR"
        fi
        COMMENT_BODY=$(cat)
        COMMENT_FILE=""
        if [ -z "$(printf '%s' "$COMMENT_BODY" | tr -d '[:space:]')" ]; then
            log_error "Refusing empty stdin body (pipe content or use --body/--body-file)"
            exit "$EXIT_GENERAL_ERROR"
        fi
    fi

    post_comment
}

main "$@"
