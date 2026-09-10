#!/bin/bash
# next-id.sh - Resolve the next free numeric suffix or in-document ID deterministically
# Version: 1.0.0
# Description: Two modes — filename mode (next free {N} in a file-name pattern)
#              and in-doc mode (next sequential PREFIX-NNN token inside a file).
# Requirements: Bash 4.0+

set -euo pipefail

source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Resolve next free numeric suffix or in-document ID"

PATTERN=""
DIR="."
FILE=""
PREFIX=""
WIDTH=""
PRINT_FILENAME=0

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

Resolve the next free numeric identifier deterministically. Two modes:

Filename mode (one of --pattern):
    next-id --pattern 'Plan-issue-42-{N}.md' [--dir DIR] [--width W] [--filename]
    Scans DIR for files matching the pattern with {N} as a digit run,
    finds the highest existing number, prints the next one.

In-document mode (--file + --prefix):
    next-id --file Specifications-orders-001.md --prefix 'SPEC-'
    Scans the file for PREFIX-NNN tokens (zero-padded or not),
    finds the highest, prints the next number (--full prints PREFIX-NNN).

Options:
    --pattern GLOB               Filename pattern containing {N} (filename mode)
    --dir DIR                    Directory to scan (default: current directory)
    --width W                    Zero-pad width override (default: widest existing, min 1)
    --filename                   Print the full next filename instead of just the number
    --file FILE                  Document to scan (in-doc mode)
    --prefix PREFIX              ID prefix to scan for, e.g. 'SPEC-', 'Q-', 'ADR-', 'AC-'
    --full                       In-doc mode: print 'PREFIX<NNN>' instead of the bare number
    -V, --verbose                Enable verbose logs
    -h, --help                   Show help and exit
    -v, --version                Show version and exit

Output: the next number (zero-padded like existing entries), or the full
filename / PREFIX-NNN with --filename / --full.

Exit Codes:
    0 success
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
        invalid_args "Required arguments are missing"
    fi

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help) show_usage ;;
            -v|--version)
                echo "$SCRIPT_VERSION"
                exit 0
                ;;
            -V|--verbose) shift ;;  # flag accepted for CLI consistency
            --pattern)
                [ -z "${2:-}" ] && invalid_args "Missing value for --pattern"
                PATTERN="$2"; shift 2 ;;
            --dir)
                [ -z "${2:-}" ] && invalid_args "Missing value for --dir"
                DIR="$2"; shift 2 ;;
            --width)
                [ -z "${2:-}" ] && invalid_args "Missing value for --width"
                WIDTH="$2"; shift 2 ;;
            --filename) PRINT_FILENAME=1; shift ;;
            --file)
                [ -z "${2:-}" ] && invalid_args "Missing value for --file"
                FILE="$2"; shift 2 ;;
            --prefix)
                [ -z "${2:-}" ] && invalid_args "Missing value for --prefix"
                PREFIX="$2"; shift 2 ;;
            --full) FULL=1; shift ;;
            *) invalid_args "Unknown option: $1" ;;
        esac
    done

    if [ -n "$PATTERN" ] && { [ -n "$FILE" ] || [ -n "$PREFIX" ]; }; then
        invalid_args "--pattern cannot be combined with --file/--prefix"
    fi
    if [ -n "$FILE" ] && [ -z "$PREFIX" ]; then
        invalid_args "--prefix is required with --file"
    fi
    if [ -z "$PATTERN" ] && [ -z "$FILE" ]; then
        invalid_args "Provide --pattern (filename mode) or --file + --prefix (in-doc mode)"
    fi

    local max_num=0 max_width=0 n w

    if [ -n "$PATTERN" ]; then
        if [ ! -d "$DIR" ]; then
            invalid_args "Directory not found: $DIR"
        fi
        # Locate the {N} placeholder by plain string ops — parameter-
        # expansion patterns mis-handle the braces.
        local npos
        npos="${PATTERN%%\{N\}*}"   # text before the {N} placeholder
        npos="${#npos}"             # its length = index of {N}
        if [ "$npos" -ge "${#PATTERN}" ]; then
            invalid_args "--pattern must contain the {N} placeholder"
        fi
        local literal_prefix="${PATTERN:0:$npos}"
        local glob="${PATTERN:0:$npos}*${PATTERN:$((npos+3))}"
        local f base rest
        while IFS= read -r f; do
            [ -e "$f" ] || continue
            base="$(basename "$f")"
            rest="${base#"$literal_prefix"}"
            # {N} = leading digit run after the literal prefix; the glob
            # already constrains whatever follows (fixed suffix, -* tail, ...)
            if [[ "$rest" =~ ^([0-9]+) ]]; then
                n="${BASH_REMATCH[1]}"
                if [ "$n" -gt "$max_num" ]; then
                    max_num="$n"
                fi
                w="${#n}"
                [ "$w" -gt "$max_width" ] && max_width="$w"
            fi
        done < <(compgen -G "$DIR/$glob" 2>/dev/null || true)
    else
        # In-document mode: PREFIX-NNN tokens anywhere in the file
        if [ ! -f "$FILE" ]; then
            invalid_args "File not found: $FILE"
        fi
        local esc_prefix
        esc_prefix="${PREFIX//+/\\+}"
        while IFS= read -r n; do
            [ -n "$n" ] || continue
            if [ "$n" -gt "$max_num" ]; then max_num="$n"; fi
            w="${#n}"
            [ "$w" -gt "$max_width" ] && max_width="$w"
        done < <(grep -oE "${esc_prefix}[0-9]+" "$FILE" 2>/dev/null \
                 | sed "s/^${esc_prefix}//" | sort -u || true)
    fi

    local next=$((max_num + 1))
    local pad_width
    if [ -n "$WIDTH" ]; then
        pad_width="$WIDTH"
    elif [ "$max_width" -gt 0 ]; then
        pad_width="$max_width"
    else
        pad_width=1
    fi

    local padded
    padded=$(printf '%0*d' "$pad_width" "$next")

    if [ -n "$PATTERN" ]; then
        if [ "$PRINT_FILENAME" -eq 1 ]; then
            echo "${PATTERN//\{N\}/$padded}"
        else
            echo "$padded"
        fi
    else
        if [ "${FULL:-0}" -eq 1 ]; then
            echo "${PREFIX}${padded}"
        else
            echo "$padded"
        fi
    fi
}

main "$@"
