#!/bin/bash
# workflow-signal.sh - Manually signal workflow events for one or many issues.
#
# Ergonomic front door to the _on_* event system: same dispatcher the skills
# and PR tooling use, so rollup, cascade, and the loop guard apply
# automatically. Primary use: deploy-sourced events with no automatic
# observer (staging-deploy, production-deploy); secondary: manual
# corrections. Best-effort per issue: one failure never blocks the rest.
#
# Usage:
#   workflow-signal <event> <issue>... [<event> <issue>... ...]
#   workflow-signal --list
#
# Event names: bare form accepted and normalized (staging-deploy,
# _on_staging_deploy, and _on_begin_review are all valid for that event).

# Resolve the tools root from this script's own location (self-root contract).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# Entry-point root: real tools by default; test seam overrides ONLY where
# events are looked up (libs above still load from the real tree).
SIGNAL_TOOLS_ROOT="$DEVENV_TOOLS"
if [ -n "${WORKFLOW_SIGNAL_TOOLS:-}" ]; then
    SIGNAL_TOOLS_ROOT="$WORKFLOW_SIGNAL_TOOLS"
fi

source "$DEVENV_TOOLS/lib/error-handling.bash"
# shellcheck source=../lib/versioning.bash
source "$DEVENV_TOOLS/lib/versioning.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Manually signal workflow events"

show_usage() {
    cat <<EOF
Usage: $SCRIPT_NAME                      (interactive: pick what happened)
       $SCRIPT_NAME <event> <issue>... [<event> <issue>... ...]
       $SCRIPT_NAME --list

Signal a workflow event for one or many issues. Events pass through the
standard _on_* dispatch path, so parent rollup, cascade, and loop-guard
rules apply automatically. Batch by passing multiple issue numbers after
an event, and repeat event/issue groups for mixed batches.

Arguments:
    event                Event name; bare form accepted and normalized
                         (staging-deploy = _on_staging_deploy)
    issue...             One or more issue numbers for that event

Options:
    -h, --help           Show this help message and exit
    -v, --version        Show version information and exit
    -l, --list           List available events and exit

Examples:
    # Mark two issues deployed to staging
    $SCRIPT_NAME staging-deploy 101 102

    # Mixed batch
    $SCRIPT_NAME production-deploy 101 begin-review 105 106
EOF
}

# Normalize an event name to the _on_<event> entry-point form: accept the
# bare name with hyphens or underscores (staging-deploy, staging_deploy,
# _on_staging_deploy all resolve to _on_staging_deploy).
# Interactive mode: pick "what happened" from the event list (fzf), then
# type issue numbers. Falls back to a numbered menu when fzf is unavailable.
interactive_mode() {
    local events event issue_args i opt
    events="$(list_events)"
    if [ -z "$events" ]; then
        log_error "No event entry points found"
        exit 1
    fi
    # fzf only in a genuinely interactive session: piped stdin (tests,
    # scripted calls) takes the numbered-menu fallback, which reads that
    # same stdin for the selection.
    if check_fzf_installed 2>/dev/null && [ -t 0 ]; then
        event="$(printf '%s\n' "$events" | fzf --prompt='What happened? > ' --height=40%)" || {
            echo "Cancelled."
            exit 0
        }
    else
        i=1
        printf 'What happened?\n'
        while IFS= read -r opt; do
            printf '  %d) %s\n' "$i" "$opt"
            i=$((i + 1))
        done <<< "$events"
        read -rp "Select [1-$((i-1))]: " i
        event="$(printf '%s\n' "$events" | sed -n "${i}p")"
        if [ -z "$event" ]; then
            echo "Invalid choice."
            exit 1
        fi
    fi
    printf 'Signal %s for which issues (space-separated numbers)? ' "$event"
    read -r issue_args
    [ -n "$issue_args" ] || { echo "No issues given."; exit 0; }
    # Re-enter the direct path with the picked event + numbers.
    signal_from_args "$event" $issue_args
}

normalize_event() {
    local name="$1"
    name="${name#_on_}"
    name="${name//-/_}"
    printf '_on_%s' "$name"
}

# Resolve the entry point for an event; empty string when it does not exist.
entry_point_for() {
    local event="$1"
    local ep="$SIGNAL_TOOLS_ROOT/$event"
    if [ -x "$ep" ]; then
        printf '%s' "$ep"
    else
        printf ''
    fi
}

list_events() {
    local ep name
    for ep in "$SIGNAL_TOOLS_ROOT"/_on_*; do
        [ -x "$ep" ] || continue
        name="$(basename "$ep")"
        printf '%s\n' "$name"
    done
}

main() {
    if [ "${1:-}" = "-l" ] || [ "${1:-}" = "--list" ]; then
        list_events
        exit 0
    fi

    if [ $# -eq 0 ]; then
        interactive_mode
    fi

    if [ $# -lt 2 ]; then
        case "${1:-}" in
            -h|--help|-v|--version) ;;
            *)
                if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
                    log_error "Issue number '$1' appears before any event name"
                else
                    log_error "An event requires at least one issue number"
                fi
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    fi

    signal_from_args "$@"
}

signal_from_args() {
    local current_event="" rc=0 did_any=0
    local arg
    while [ $# -gt 0 ]; do
        arg="$1"
        shift
        case "$arg" in
            -h|--help)
                show_usage
                exit 0
                ;;
            -v|--version)
                echo "$SCRIPT_VERSION"
                exit 0
                ;;
            -l|--list)
                list_events
                exit 0
                ;;
            *)
                if [[ "$arg" =~ ^[0-9]+$ ]]; then
                    if [ -z "$current_event" ]; then
                        log_error "Issue number '$arg' appears before any event name"
                        echo "Use --help for usage information"
                        exit 1
                    fi
                    did_any=1
                    if bash "$SIGNAL_TOOLS_ROOT/$current_event" "$arg" >/dev/null 2>&1; then
                        echo "signalled $current_event for issue #$arg"
                    else
                        echo "WARNING: signal $current_event failed for issue #$arg (best-effort, continuing)" >&2
                        rc=1
                    fi
                else
                    local normalized ep
                    normalized="$(normalize_event "$arg")"
                    ep="$(entry_point_for "$normalized")"
                    if [ -z "$ep" ]; then
                        log_error "Unknown event '$arg' (normalized: '$normalized'; see --list)"
                        exit 1
                    fi
                    current_event="$normalized"
                fi
                ;;
        esac
    done

    if [ "$did_any" -eq 0 ]; then
        log_error "No issues signalled - each event needs at least one issue number"
        echo "Use --help for usage information"
        exit 1
    fi
    exit "$rc"
}

main "$@"
