#!/usr/bin/env bash
# markdown-plan-complete-ac.sh - Mark one or more acceptance criteria as complete or incomplete
# Version: 1.0.0
# Description: Toggles the checkbox state of one or more acceptance-criteria
#              items in a markdown requirements or plan document.  AC items
#              are identified by their dotted number, e.g. "AC-3" or "AC-1.2".
# Requirements: Bash 4.0+, awk, grep, sed

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"

enable_strict_mode

readonly SCRIPT_VERSION="1.0.0"
# shellcheck disable=SC2155
readonly SCRIPT_NAME="$(basename "$0")"

script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Mark one or more acceptance criteria as complete or incomplete"

source "$DEVENV_TOOLS/lib/markdown.bash"

# ============================================================================
# Global Variables
# ============================================================================

PLAN_FILE=""
AC_NUMBERS=()
UNCOMPLETE=0
VERBOSE=0

# ============================================================================
# Usage
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS] AC_NUMBER... [FILE]

Mark one or more acceptance-criteria checkboxes as complete or incomplete.

AC items are identified by their number, e.g. "AC-3" or "AC-1.2", as they
appear in requirements or plan documents.

Positional arguments are classified automatically: any argument matching the
AC-N / AC-N.N / AC-N.N.N pattern is treated as an AC number; anything else is
treated as the file path.  At most one file may be given.  If no file is given,
the first Requirements-*.md found in the current directory is used; if none
exists, the first Implementation_plan-*.md is tried.

Arguments:
    AC_NUMBER...    One or more AC numbers to update (AC-N, AC-N.N, AC-N.N.N)
    FILE            Path to the markdown file (optional).

Options:
    -h, --help          Show this help message and exit
    -v, --version       Show version information and exit
    -V, --verbose       Enable verbose output
    --uncomplete        Mark the criteria as incomplete ([ ]) instead of complete ([x])

Examples:
    # Mark AC-3 complete in the auto-detected requirements file
    $SCRIPT_NAME AC-3

    # Mark several criteria complete at once
    $SCRIPT_NAME AC-1 AC-2 AC-3

    # Mark criteria complete in a specific file (file can appear anywhere)
    $SCRIPT_NAME AC-1 AC-2 /path/to/Requirements-001.md

    # Undo (mark incomplete)
    $SCRIPT_NAME --uncomplete AC-3 AC-4

Exit Codes:
    0   All criteria updated successfully
    1   One or more criteria failed (not found, etc.)
    2   Invalid arguments
    4   File not found

EOF
    exit 0
}

# ============================================================================
# Argument Parsing
# ============================================================================

parse_args() {
    local positional=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                show_usage
                ;;
            -v|--version)
                exit 0
                ;;
            -V|--verbose)
                VERBOSE=1
                shift
                ;;
            --uncomplete)
                UNCOMPLETE=1
                shift
                ;;
            -*)
                log_error "Unknown option: $1"
                log_info "Run '$SCRIPT_NAME --help' for usage."
                exit "$EXIT_INVALID_ARGUMENT"
                ;;
            *)
                positional+=("$1")
                shift
                ;;
        esac
    done

    if [ "${#positional[@]}" -eq 0 ]; then
        log_error "At least one AC_NUMBER is required."
        log_info "Run '$SCRIPT_NAME --help' for usage."
        exit "$EXIT_INVALID_ARGUMENT"
    fi

    # Classify each positional arg: AC numbers match AC-N[.N...]; anything
    # else is the file path.  Error on more than one non-AC argument.
    for arg in "${positional[@]}"; do
        if validate_plan_ac_number "$arg" 2>/dev/null; then
            AC_NUMBERS+=("$arg")
        else
            if [ -n "$PLAN_FILE" ]; then
                log_error "Unexpected argument '$arg': file already set to '$PLAN_FILE'."
                log_info "Run '$SCRIPT_NAME --help' for usage."
                exit "$EXIT_INVALID_ARGUMENT"
            fi
            PLAN_FILE="$arg"
        fi
    done

    if [ "${#AC_NUMBERS[@]}" -eq 0 ]; then
        log_error "At least one AC_NUMBER is required."
        log_info "Run '$SCRIPT_NAME --help' for usage."
        exit "$EXIT_INVALID_ARGUMENT"
    fi
}

# ============================================================================
# Helpers
# ============================================================================

# Resolve the file: use the explicit argument if given, otherwise auto-detect.
# Looks for Requirements-*.md first, then Implementation_plan-*.md.
resolve_plan_file() {
    if [ -n "$PLAN_FILE" ]; then
        if [ ! -f "$PLAN_FILE" ]; then
            log_error "File not found: $PLAN_FILE"
            exit "$EXIT_NOT_FOUND"
        fi
        return
    fi

    local found
    found=$(find . -maxdepth 1 -name 'Requirements-*.md' | sort | head -1)

    if [ -z "$found" ]; then
        found=$(find . -maxdepth 1 -name 'Implementation_plan-*.md' | sort | head -1)
    fi

    if [ -z "$found" ]; then
        log_error "No Requirements-*.md or Implementation_plan-*.md file found in the current directory."
        log_info "Specify the file explicitly as one of the arguments."
        exit "$EXIT_NOT_FOUND"
    fi

    PLAN_FILE="$found"
    log_info "Using file: $PLAN_FILE"
}

# ============================================================================
# Main
# ============================================================================

main() {
    parse_args "$@"

    [ "$VERBOSE" -eq 1 ] && export ERROR_HANDLING_LOG_LEVEL=0

    resolve_plan_file

    local state="complete"
    [ "$UNCOMPLETE" -eq 1 ] && state="incomplete"

    local failures=0
    for ac in "${AC_NUMBERS[@]}"; do
        set_plan_ac_complete "$PLAN_FILE" "$ac" "$state" || {
            log_error "Failed to mark $ac as ${state}"
            failures=$((failures + 1))
        }
    done

    # Print a summary of overall AC progress
    local counts completed total
    counts=$(count_plan_acs "$PLAN_FILE")
    completed="${counts%% *}"
    total="${counts##* }"
    log_info "AC progress: $completed/$total criteria complete in $(basename "$PLAN_FILE")"

    [ "$failures" -eq 0 ] || exit "$EXIT_GENERAL_ERROR"
}

main "$@"
