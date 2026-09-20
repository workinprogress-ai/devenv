#!/bin/bash
# _on_event_dispatch.sh - Dispatcher for the _on_* skill event tooling class.
#
# CONTRACT:
#   _on_event_dispatch.sh <event-name> <issue-number>
#
# Behavior (all pinned by grooming decisions):
# - Delegates to workflow_on_event in tools/lib/workflow-core.bash, which
#   owns resolution (vocabulary: tools/config/skill-events.yml + config
#   order), writing, and propagation
# - Fans the write out via project-update-issue --all-projects --safe
#   (strict-default + --safe; skip-and-report on unreadable projects)
# - BEST-EFFORT: any failure prints a warning and exits 0 —
#   status plumbing never blocks skill work. Transitions are idempotent
#   (fixed values), so a later signal repairs drift from a failed run.
# - Unknown event: warn + exit 0 (schema tolerance)
# - Skills call the _on_* entry scripts; they never read the config,
#   never name projects, never contain Status vocabulary.
#
# The tools/scripts/_on_<event>.sh entry scripts (internal, no depth-1
# entries) delegate here.
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

    # The workflow library owns resolution, writing, and propagation;
    # this dispatcher is a stable entry-point shim.
    local lib
    lib="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/workflow-core.bash"
    if [ ! -f "$lib" ]; then
        log_warn "workflow-core.bash not found - cannot transition (best-effort, continuing)"
        return 0
    fi
    # shellcheck source=../lib/workflow-core.bash
    source "$lib"
    workflow_on_event "$event" "$issue"
    return 0
}

main "$@"
