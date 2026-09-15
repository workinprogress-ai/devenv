#!/usr/bin/env bash
# body-source.bash - Shared markdown body-source resolution for tools
# Version: 1.0.0
# Description: Single implementation of body-source semantics for tools that
#              ingest markdown: --body TEXT, --body-file FILE, --body-file -
#              (stdin), piped-stdin auto-read, and interactive-request fallback.
# Requirements: Bash 4.0+

# Guard against multiple sourcing
if [ -n "${_BODY_SOURCE_LOADED:-}" ]; then
    return 0
fi
readonly _BODY_SOURCE_LOADED=1

# Body-source resolution outcomes (returned via BODY_SOURCE_RESULT):
#   text          - plain text given via --body
#   file          - file contents read from a named path
#   stdin         - body read from stdin (explicit '-' or piped auto-read)
#   interactive   - no source given and stdin is a TTY; caller offers its
#                   interactive picker (e.g. an fzf file list)
#   none          - no source given and stdin is not a TTY: caller errors

# ============================================================================
# TTY detection
# ============================================================================

# body_source_stdin_is_tty
#   Returns 0 when stdin is attached to a terminal (interactive invocation),
#   1 otherwise. Uses [ -t 0 ] so it works under bash on Linux and macOS.
body_source_stdin_is_tty() {
    [ -t 0 ]
}

# ============================================================================
# Body-source resolution
# ============================================================================

# body_source_resolve BODY_TEXT BODY_FILE
#   Resolves the body from the given flag values plus the ambient stdin state.
#   Sets BODY_SOURCE_RESULT to one of the outcomes above and prints the body
#   text for text/file/stdin outcomes (prints nothing for interactive/none).
#
#   Precedence (decision D1):
#     1. --body text                  -> text
#     2. --body-file PATH             -> file   ('-' means stdin: decision D4)
#     3. no flags, stdin piped        -> stdin  (auto-read; never a TTY here)
#     4. no flags, stdin is a TTY     -> interactive (caller-driven)
#     5. no flags, stdin unavailable  -> none   (caller errors; never hang)
#
#   Empty stdin (0 bytes piped), whitespace-only stdin, and a closed stdin
#   are all hard errors (exit 2, "Refusing empty stdin body"): an empty
#   body is never valid, and silence is how caller bugs hide. The probe
#   never blocks — the 1s read timeout only fires on a stalled pipe.
#
#   Returns non-zero (2) for: empty/whitespace-only/closed stdin, both flags
#   given, or a missing file. Returns 0 for all resolution outcomes.
# shellcheck disable=SC2034  # BODY_SOURCE_RESULT is the caller-facing contract
body_source_resolve() {
    local body_text="${1:-}"
    local body_file="${2:-}"

    if [ -n "$body_text" ] && [ -n "$body_file" ]; then
        echo "Only one body source may be specified" >&2
        return 2
    fi

    if [ -n "$body_text" ]; then
        BODY_SOURCE_RESULT="text"
        printf '%s\n' "$body_text"
        return 0
    fi

    if [ -n "$body_file" ]; then
        if [ "$body_file" = "-" ]; then
            BODY_SOURCE_RESULT="stdin"
            cat
            return 0
        fi
        if [ ! -f "$body_file" ]; then
            echo "File not found: $body_file" >&2
            return 2
        fi
        BODY_SOURCE_RESULT="file"
        cat "$body_file"
        return 0
    fi

    if ! body_source_stdin_is_tty; then
        # Piped or redirected stdin with no source flag: auto-read (D1).
        # capture prints the validated content to stdout and cleans up its
        # temp file; nothing further to emit here.
        body_source_capture_stdin || return 2
        BODY_SOURCE_RESULT="stdin"
        return 0
    fi

    # stdin is a TTY and no flags were given: hand control to the caller's
    # interactive picker rather than hanging or surprising the user.
    BODY_SOURCE_RESULT="interactive"
    return 0
}
# ============================================================================
# Stdin capture core
# ============================================================================

# body_source_capture_stdin
#   Reads all of stdin (never a TTY — callers must TTY-check first) into a
#   temp file, validates it, then prints the content to stdout and removes
#   the temp file. rc=0 = content on stdout; capture it with $( ) freely —
#   it is already validated. rc=2 with "Refusing empty stdin body" on
#   stderr: empty, whitespace-only, or closed stdin are all hard errors,
#   and the probe never blocks — the 1s read timeout only fires on a
#   stalled (open but silent) pipe.
#
#   Whitespace is judged on the WHOLE stream, not the first byte: a body may
#   legitimately start with a blank line.
body_source_capture_stdin() {
    BODY_SOURCE_CAPTURE_FILE=$(mktemp "${TMPDIR:-/tmp}/body-source.XXXXXX")

    local probe=""
    if ! IFS= read -r -t 1 -n 1 probe 2>/dev/null; then
        rm -f "$BODY_SOURCE_CAPTURE_FILE"
        echo "Refusing empty stdin body (pipe content or use --body/--body-file)" >&2
        return 2
    fi
    printf '%s' "$probe" > "$BODY_SOURCE_CAPTURE_FILE"
    cat >> "$BODY_SOURCE_CAPTURE_FILE"

    if [ -z "$(tr -d '[:space:]' < "$BODY_SOURCE_CAPTURE_FILE")" ]; then
        rm -f "$BODY_SOURCE_CAPTURE_FILE"
        echo "Refusing empty stdin body (pipe content or use --body/--body-file)" >&2
        return 2
    fi
    # Success contract: content on stdout (safe to capture with $()),
    # path in BODY_SOURCE_CAPTURE_FILE, temp file already removed — direct
    # callers own nothing after this returns.
    cat "$BODY_SOURCE_CAPTURE_FILE"
    rm -f "$BODY_SOURCE_CAPTURE_FILE"
    return 0
}



# ============================================================================
# Common option-loop helper
# ============================================================================

# body_source_register_option KEY VALUE
# body_source_validate_sources EXTRA_MODE
#   Validates that exactly one source is set. EXTRA_MODE is the tool's own
#   additional source channel (e.g. "edit" for --edit) or "none".
#   Prints an error and returns 2 when zero or multiple sources are present.
body_source_validate_sources() {
    local extra_mode="${1:-none}"
    local count=0

    [ -n "$BODY_SOURCE_TEXT" ] && count=$((count + 1))
    [ -n "$BODY_SOURCE_FILE" ] && count=$((count + 1))
    [ "$extra_mode" != "none" ] && [ -n "$extra_mode" ] && count=$((count + 1))

    if [ "$count" -eq 0 ]; then
        echo "A body source is required" >&2
        return 2
    fi
    if [ "$count" -gt 1 ]; then
        echo "Only one body source may be specified" >&2
        return 2
    fi
    return 0
}
