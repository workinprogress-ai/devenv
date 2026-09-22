#!/bin/bash
# workflow-core.bash - The workflow state model: policy and orchestration only.
#
# BOUNDARY CONDITION (enforced by test): zero direct I/O in this file. All
# reads go through issue-graph.bash helpers; all writes go through the
# project-update-issue fan-out invoked as a subprocess. This file decides;
# the tools do. A fork editing rules here cannot break transport.
#
# Interface:
#   workflow_on_event <event> <issue>
#       The dispatcher's entire job. Resolves event -> status (vocabulary
#       from config order + skill-events.yml), writes via fan-out, then
#       propagates (rollup up the parent chain, one-shot cascade down).
#   workflow_apply_status <issue> <status> [child|parent]
#       Forced/statused writes from tooling. direction governs propagation:
#       "child" rolls the parent up; "parent" cascades to children once.
#   workflow_recompute_parent <issue>
#       Fired by parent-linking operations so newly linked children take
#       effect (the new-child-pulls-parent-back edge).
#
# Semantics (design-settled):
# - Vocabulary order comes from devenv.config [workflows] status_workflow.
# - DELIVERY segment = Implementing..Production. Pre-delivery = earlier states.
# - Rollup: parent = pure function of current child states. All children
#   pre-delivery -> parent keeps its own state. Any child in delivery ->
#   parent = min child state, pre-delivery children floored at Implementing.
# - Sanctioned regression propagates: statuses are revocable current-state.
# - Cascade is one-shot and does not re-rollup; gated states reject forcing.
# - Loop guard: all writes flow through workflow_apply_status; rollup writes
#   suppress upward re-propagation; climbs continue only on actual change.
# - Best-effort: failures warn and exit 0; status plumbing never blocks work.

# Prevent multiple sourcing
if [ -n "${_WORKFLOW_CORE_LOADED:-}" ]; then return 0; fi
readonly _WORKFLOW_CORE_LOADED=1

# shellcheck disable=SC2034  # read by callers that source this library
WORKFLOW_CORE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Workflow status semantics are org policy: the delivery-segment anchor and
# the unreadable-status fallback resolve via the policy layer (config-driven,
# POLICY_* overridable) with the current org's values as built-in fallback.
# shellcheck disable=SC1090,SC1091
source "$WORKFLOW_CORE_DIR/policy/policy-core.bash"
policy_core_init "${DEVENV_ROOT:-$(cd "$WORKFLOW_CORE_DIR/../.." && pwd)}/devenv.config" 2>/dev/null || true
# shellcheck disable=SC1090,SC1091
source "$WORKFLOW_CORE_DIR/policy/workflow-policy.bash"
WORKFLOW_POLICY_ANCHOR="$(policy_delivery_segment_anchor)"
WORKFLOW_POLICY_FALLBACK="$(policy_status_fallback)"
# Hierarchy reads live in issue-graph.bash (all I/O stays out of this file).
# shellcheck source=issue-graph.bash
source "$WORKFLOW_CORE_DIR/issue-graph.bash"

# Ordered vocabulary. Single source: devenv.config [workflows]
# status_workflow. WORKFLOW_ORDER_OVERRIDE exists for fork/testing use and
# must remain a comma-separated token list in progression order.
workflow_order() {
    if [ -n "${WORKFLOW_ORDER_OVERRIDE:-}" ]; then
        # Normalize comma-separated override to the whitespace token stream
        # every consumer iterates (same contract as config_read_array).
        printf '%s' "$WORKFLOW_ORDER_OVERRIDE" | tr ',' ' '
        return 0
    fi
    local cfg
    cfg="${DEVENV_ROOT:-$(cd "$WORKFLOW_CORE_DIR/../.." && pwd)}/devenv.config"
    # shellcheck source=../config-reader.bash
    source "$WORKFLOW_CORE_DIR/config-reader.bash"
    config_init "$cfg" 2>/dev/null || true
    config_read_array workflows status_workflow
}

# Resolve a status token's position in the configured workflow order.
# Echoes the 0-based index; rc=1 when unknown to the vocabulary.
workflow_status_order() {
    local token="$1" order i=0 t
    [ -n "$token" ] || return 1
    order="$(workflow_order)"
    [ -n "$order" ] || return 1
    for t in $order; do
        [ "$t" = "$token" ] && { echo "$i"; return 0; }
        i=$((i + 1))
    done
    return 1
}

# Compute the rolled-up parent status from child statuses. Pure function.
# Undefined (rc=1, no output) when: no children, any unknown status, or all
# children pre-delivery (the caller leaves the parent's own state alone).
# Otherwise echoes the minimum child state where pre-delivery children are
# floored at the first delivery state.
workflow_compute_rollup() {
    [ $# -gt 0 ] || return 1
    local order delivery_idx min_idx=-1 st idx
    order="$(workflow_order)"
    [ -n "$order" ] || return 1
    # First delivery index: position of "Implementing" in the configured
    # order. The delivery segment is Implementing..last; anything earlier is
    # pre-delivery. Unknown token -> hard error (vocabulary mismatch).
    delivery_idx="$(workflow_status_order "$WORKFLOW_POLICY_ANCHOR")" || return 1
    for st in "$@"; do
        idx="$(workflow_status_order "$st")" || return 1
        if [ "$idx" -lt "$delivery_idx" ]; then
            idx="$delivery_idx"
        fi
        if [ "$min_idx" -eq -1 ] || [ "$idx" -lt "$min_idx" ]; then
            min_idx="$idx"
        fi
    done
    # All children pre-delivery: their floored indices all equal
    # delivery_idx, indistinguishable from a genuine Implementing child, so
    # this function must not decide that case - signal undefined instead.
    local any_delivery=0
    for st in "$@"; do
        idx="$(workflow_status_order "$st")" || return 1
        [ "$idx" -ge "$delivery_idx" ] && any_delivery=1
    done
    [ "$any_delivery" -eq 1 ] || return 1
    local i=0 t
    for t in $order; do
        [ "$i" -eq "$min_idx" ] && { echo "$t"; return 0; }
        i=$((i + 1))
    done
    return 1
}

# Map an event to its configured status token via the skill-events data
# (absorbed read-side; see issue-graph.bash for hierarchy reads).
workflow_event_status() {
    local event="$1"
    # shellcheck source=skill-events.bash
    source "$WORKFLOW_CORE_DIR/skill-events.bash"
    event_status_for "$event"
}

# Internal: write a status to an issue via the fan-out wrapper. All writes
# in this library funnel through here (single guarded choke point).
# $3 = "suppress" -> rollup-computed write: do NOT propagate upward.
_workflow_write() {
    local issue="$1" status="$2" mode="${3:-}"
    # Entry-point root: real tools by default; test seam overrides ONLY where
    # the fan-out wrapper is found (same pattern as WORKFLOW_SIGNAL_TOOLS).
    local tools_root="${WORKFLOW_CORE_TOOLS:-$WORKFLOW_CORE_DIR/..}"
    local wrapper="$tools_root/scripts/project-update-issue.sh"
    if ! bash "$wrapper" "$issue" --status "$status" --all-projects --safe >/dev/null 2>&1; then
        echo "WARNING: workflow write '$status' failed for issue #$issue (best-effort, continuing)" >&2
        return 0
    fi
    [ "$mode" = "suppress" ] && return 0
    # Child-context write: roll the parent up (climb on change, which also
    # terminates the chain when nothing changed).
    _workflow_rollup_parent_of "$issue"
    return 0
}

# Internal: recompute an issue's parent from its children and write only on
# actual change; climbs recursively (bounded by finite statuses + tree
# depth). No parent -> no-op.
_workflow_rollup_parent_of() {
    local issue="$1"
    local parent
    parent=$(issue_parent "$issue") || return 0
    [ -n "$parent" ] || return 0
    local rolled
    rolled=$(_workflow_derive_parent_status "$parent") || return 0
    [ -n "$rolled" ] || return 0
    local current
    current=$(issue_read_status "$parent")
    [ "$rolled" = "$current" ] && return 0
    _workflow_write "$parent" "$rolled" suppress
    # Climb: the parent's own parent may now change.
    _workflow_rollup_parent_of "$parent"
    return 0
}

# Internal: gather children statuses and run the pure rollup. Empty/undef
# when the parent keeps its own state (all pre-delivery / no children).
_workflow_derive_parent_status() {
    local parent="$1"
    local children
    children=$(issue_children "$parent") || return 1
    [ -n "$children" ] || return 1
    local statuses=() c st
    while IFS= read -r c; do
        [ -n "$c" ] || continue
        st=$(issue_read_status "$c")
        [ -n "$st" ] || st="$WORKFLOW_POLICY_FALLBACK"   # unreadable counts as pre-delivery
        statuses+=("$st")
    done <<< "$children"
    [ "${#statuses[@]}" -gt 0 ] || return 1
    workflow_compute_rollup "${statuses[@]}"
}

# Entry: the dispatcher's entire job.
workflow_on_event() {
    local event="$1" issue="$2"
    if [ -z "$event" ] || [ -z "$issue" ]; then
        echo "Usage: workflow_on_event <event> <issue>" >&2
        return 1
    fi
    local status
    if ! status=$(workflow_event_status "$event"); then
        echo "Unknown event '$event' - no transition configured (best-effort, continuing)" >&2
        return 0
    fi
    _workflow_write "$issue" "$status"
    return 0
}

# Entry: statused/forced writes from tooling.
#   direction "child" (default): write + roll parent up.
#   direction "parent": cascade the write to children once, authoritative.
workflow_apply_status() {
    local issue="$1" status="$2" direction="${3:-child}"
    if [ -z "$issue" ] || [ -z "$status" ]; then
        echo "Usage: workflow_apply_status <issue> <status> [child|parent]" >&2
        return 1
    fi
    workflow_status_order "$status" >/dev/null || {
        echo "Unknown status token '$status' (vocabulary mismatch)" >&2
        return 1
    }
    if [ "$direction" = "parent" ]; then
        local delivery_idx idx
        delivery_idx=$(workflow_status_order "$WORKFLOW_POLICY_ANCHOR") || return 1
        idx=$(workflow_status_order "$status") || return 1
        if [ "$idx" -lt "$delivery_idx" ]; then
            echo "Status '$status' is gated - it cannot be forced; workflow states advance by their own signals" >&2
            return 1
        fi
        _workflow_write "$issue" "$status" suppress
        local children c
        children=$(issue_children "$issue") || children=""
        while IFS= read -r c; do
            [ -n "$c" ] || continue
            _workflow_write "$c" "$status" suppress
        done <<< "$children"
        return 0
    fi
    _workflow_write "$issue" "$status"
    return 0
}

# Entry: recompute a freshly linked child's parent (parent-link operations).
workflow_recompute_parent() {
    local issue="$1"
    [ -n "$issue" ] || return 1
    _workflow_rollup_parent_of "$issue"
    return 0
}
