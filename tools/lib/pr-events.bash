#!/bin/bash
# pr-events.bash - Fire _on_* skill event signals from local PR tooling.
#
# Local-tooling model: PR wrappers fire signals at their
# success points. Everything runs on the developer machine under the user's
# own gh auth (keychain-first, issue #35) - no CI, no secrets. Web-UI merges
# fire nothing: the user owns status changes they make outside local tooling.
#
# Best-effort (D-008): these functions NEVER return non-zero and never alter
# the caller's exit code. Signals are idempotent - double-firing is safe.

# Prevent multiple sourcing
if [ -n "${_PR_EVENTS_LOADED:-}" ]; then return 0; fi
readonly _PR_EVENTS_LOADED=1

# Provider layer: pr verbs route through the abstraction (slice 3/#36).
if [ -z "${_PROVIDER_CORE_LOADED:-}" ]; then
    _pe_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "$_pe_lib_dir/providers/provider-core.bash" ]; then
        # shellcheck disable=SC1091
        source "$_pe_lib_dir/providers/provider-core.bash"
        provider_detect "${DEVENV_ROOT:-$(dirname "$(dirname "$_pe_lib_dir")")}/devenv.config" 2>/dev/null || PROVIDER_NAME="${PROVIDER_NAME:-github}"
        # shellcheck disable=SC1091
        source "$_pe_lib_dir/providers/${PROVIDER_NAME}/prs.bash"
    fi
    unset _pe_lib_dir
fi

# Extract linked issue numbers from a PR body (closing keywords:
# Closes/Closed/Close, Fixes/Fixed/Fix, Resolves/Resolved, plural forms,
# optional colon). Deduplicated, capped at 10.
# Usage: pr_events_parse_issues <pr-body>
pr_events_parse_issues() {
    printf '%s' "${1:-}" \
        | grep -oiE '(^|[[:space:]])(close[sd]?|fix(e[sd])?|resolve[sd]?):? #[0-9]+' \
        | grep -oE '#[0-9]+' | tr -d '#' | sort -u | head -10
}

# Map a local PR lifecycle point to its event name.
# Usage: pr_events_event_for <created|merged>
pr_events_event_for() {
    case "$1" in
        created) echo "_on_begin_review" ;;
        merged)  echo "_on_merge" ;;
        *)       return 1 ;;
    esac
}

# Fire a signal for every issue linked in the given PR body.
# Usage: pr_events_signal <created|merged> <pr-body>
# Always returns 0 (best-effort); logs one line per signal or a warning.
pr_events_signal() {
    local point="$1"
    local body="${2:-}"

    local event
    event=$(pr_events_event_for "$point") || return 0

    local issues
    issues=$(pr_events_parse_issues "$body")
    if [ -z "$issues" ]; then
        return 0
    fi

    # Signal via the scripts/_on_<event>.sh entry points; resolve their
    # location relative to this library (self-root contract). Underscore-
    # prefixed scripts are internal by contract: no depth-1 entry exists.
    local tools_dir
    tools_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    local issue
    for issue in $issues; do
        if bash "$tools_dir/scripts/$event.sh" "$issue" >/dev/null 2>&1; then
            echo "event: signalled $event for issue #$issue (PR $point)"
        else
            echo "WARNING: event signal $event failed for issue #$issue (best-effort, continuing)" >&2
        fi
    done
    return 0
}

# Convenience: fetch a PR body then signal. Quiet failure (no PR / no perms).
# Usage: pr_events_signal_for_pr <created|merged> <pr-number>
pr_events_signal_for_pr() {
    local point="$1"
    local pr_num="$2"
    local body
    body=$(provider_prs_view "" "$pr_num" --json body --jq '.body' 2>/dev/null) || return 0
    pr_events_signal "$point" "$body"
    return 0
}
