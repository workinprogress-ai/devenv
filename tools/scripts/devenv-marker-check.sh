#!/bin/bash
# devenv-marker-check.sh - Deterministic DEVENV-marker and AC-comment scanning
# Version: 1.1.0
# Description: Replaces hand-run grep sweeps: verify no DEVENV[ scaffolding
#              markers remain (gate mode), list [AC-N] comments for review
#              (finder mode), list scoped TODO(DEVENV markers with their
#              discharge conditions (--todo-report), or check custom markers
#              with --require inversion.
# Requirements: Bash 4.0+, grep

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"

readonly SCRIPT_VERSION="1.1.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Scan for DEVENV markers and AC comments"

MARKER='DEVENV\['
AC_MODE=0
TODO_REPORT=0
REQUIRE=0
PATHS=()

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [PATH...] [OPTIONS]

Deterministic marker scanning for DEVENV workflows.

Default (gate mode): fail (exit 1) when any FIXME(DEVENV[ or
TODO(DEVENV[ marker remains under the scanned paths; print each hit
as file:line:match.

Options:
    --ac                         Finder mode: list [AC-N] DEVENV comments with
                                 file:line:match; exit 0 regardless (the AC
                                 review gate assesses them, this only finds them)
    --todo-report                Finder mode: list scoped TODO(DEVENV[ markers
                                 with file:line:match and flag any missing a
                                 discharge condition ("remove when ...");
                                 exit 0 regardless. Supports the kickoff
                                 Scoped-TODO discovery rule.
    --marker REGEX               Custom marker regex (default 'DEVENV\['), e.g.
                                 'DEVENV\[bug-hunt\]' for bug-hunter sweeps
    --require                    Invert the gate: succeed only when at least one
                                 match exists (verification sweeps like
                                 "protocol reference present in every skill")
    -V, --verbose                Enable verbose logs
    -h, --help                   Show help and exit
    -v, --version                Show version and exit

Exit Codes:
    0 gate passed (no markers) / finder mode done / --require satisfied
    1 gate failed (markers found) or --require not satisfied
    2 invalid arguments
EOF
    exit 0
}

invalid_args() {
    log_error "$1"
    echo "Use --help for usage information"
    exit 2
}

main() {
    if [ $# -eq 0 ]; then
        PATHS=(".")
    fi

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) show_usage ;;
            -v|--version)
                echo "$SCRIPT_VERSION"
                exit 0
                ;;
            -V|--verbose) shift ;;
            --ac) AC_MODE=1; shift ;;
            --todo-report) TODO_REPORT=1; shift ;;
            --marker)
                [ -z "${2:-}" ] && invalid_args "Missing value for --marker"
                MARKER="$2"; shift 2 ;;
            --require) REQUIRE=1; shift ;;
            --*) invalid_args "Unknown option: $1" ;;
            *) PATHS+=("$1"); shift ;;
        esac
    done

    if [ "${#PATHS[@]}" -eq 0 ]; then
        PATHS=(".")
    fi
    for p in "${PATHS[@]}"; do
        if [ ! -e "$p" ]; then
            invalid_args "Path not found: $p"
        fi
    done

    if [ "$AC_MODE" -eq 1 ] && [ "$TODO_REPORT" -eq 1 ]; then
        invalid_args "--ac and --todo-report are mutually exclusive"
    fi

    local regex hits=0
    if [ "$AC_MODE" -eq 1 ]; then
        regex='\[AC-[0-9]+'
    elif [ "$TODO_REPORT" -eq 1 ]; then
        regex='TODO\(DEVENV\['
    else
        regex="$MARKER"
    fi

    local result
    set +e
    result=$(grep -rnE "$regex" "${PATHS[@]}" 2>/dev/null)
    set -e

    if [ -n "$result" ]; then
        hits=$(echo "$result" | wc -l)
        echo "$result"
    fi

    if [ "$AC_MODE" -eq 1 ]; then
        if [ "$hits" -eq 0 ]; then
            echo "No AC comments found under: ${PATHS[*]}"
        fi
        exit 0
    fi

    if [ "$TODO_REPORT" -eq 1 ]; then
        if [ "$hits" -eq 0 ]; then
            echo "No scoped TODO(DEVENV markers found under: ${PATHS[*]}"
            exit 0
        fi
        local missing
        missing=$(echo "$result" | grep -cv "remove when" || true)
        if [ "$missing" -gt 0 ]; then
            log_warn "$missing of $hits scoped TODO(s) missing a discharge condition ('remove when ...') — condition-less TODOs are defects per the marker spec; resolve with the user"
        fi
        exit 0
    fi

    if [ "$REQUIRE" -eq 1 ]; then
        if [ "$hits" -eq 0 ]; then
            log_error "Required marker '$MARKER' not found under: ${PATHS[*]}"
            exit 1
        fi
        exit 0
    fi

    if [ "$hits" -gt 0 ]; then
        log_error "$hits DEVENV marker(s) found — remove them before completion"
        exit 1
    fi
    echo "Clean: no markers matching '$MARKER' under: ${PATHS[*]}"
    exit 0
}

main "$@"
