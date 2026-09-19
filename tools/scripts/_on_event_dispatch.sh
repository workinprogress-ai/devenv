#!/bin/bash
# _on_event_dispatch.sh - Dispatcher for the _on_* skill event tooling class.
#
# CONTRACT:
#   _on_event_dispatch.sh <event-name> <issue-number>
#
# Behavior (all pinned by grooming decisions):
# - Resolves the event's Status via tools/lib/skill-events.bash
#   (config: tools/config/skill-events.yml)
# - Fans the write out via project-update-issue --all-projects --safe
#   (strict-default + --safe per D-004; skip-and-report per D-005)
# - BEST-EFFORT (D-008): any failure prints a warning and exits 0 —
#   status plumbing never blocks skill work. Transitions are idempotent
#   (fixed values), so a later signal repairs drift from a failed run.
# - Unknown event: warn + exit 0 (schema tolerance)
# - Skills call the _on_* entry scripts; they never read the config,
#   never name projects, never contain Status vocabulary (D-003/D-006).
#
# The nine entry points (tools/_on_<event> thin callers) delegate here:
#   _on_begin_grooming _on_end_grooming _on_begin_planning _on_end_planning
#   _on_begin_implementation _on_end_implementation _on_begin_review
#   _on_end_review _on_merge
#
# Trigger points: skills invoke these at lifecycle boundaries; local PR
# tooling fires _on_begin_review on PR open and _on_merge on merge for
# linked issues. Best-effort + idempotent: double-firing is safe.

set -uo pipefail

# Resolve the tools root from this script's own location (self-root contract).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"

source "$DEVENV_TOOLS/lib/error-handling.bash"

main() {
    local event="${1:-}"
    local issue="${2:-}"

    if [ -z "$event" ] || [ -z "$issue" ]; then
        log_error "Usage: _on_event_dispatch.sh <event-name> <issue-number>"
        return 1
    fi

    # Resolve the event's configured Status, then fan the write out through
    # the wrapper (strict-safe per D-004: --safe always on for skills).
    # Best-effort (D-008): every failure path warns and exits 0.
    source "$DEVENV_TOOLS/lib/skill-events.bash"
    local status
    if ! status=$(event_status_for "$event"); then
        log_warn "Unknown event '$event' - no transition configured (best-effort, continuing)"
        return 0
    fi

    local wrapper="$DEVENV_TOOLS/scripts/project-update-issue.sh"
    if [ ! -f "$wrapper" ]; then
        log_warn "project-update-issue.sh not found - cannot transition (best-effort, continuing)"
        return 0
    fi

    if bash "$wrapper" "$issue" --status "$status" --all-projects --safe >/dev/null 2>&1; then
        log_info "event '$event': issue #$issue -> Status='$status' (all projects)"
    else
        log_warn "event '$event': transition to '$status' failed for issue #$issue (best-effort, continuing)"
    fi
    return 0
}

main "$@"
