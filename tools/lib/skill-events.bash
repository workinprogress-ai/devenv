#!/bin/bash
# skill-events.bash - Read-side contract for the _on_* event tooling class.
#
# Read-side contract for the _on_* event tooling class.
# - Event source of truth: tools/config/skill-events.yml
# - Event names: begin/end pairs per lifecycle phase (see the config header)
# - event_status_for <event>: echoes the configured Status token for the
#   event, or returns 1 when the event is unknown
# - event_names: echoes all configured event names, one per line
# - Unknown events NEVER abort a skill: callers treat rc=1 as warn-and-continue
#
# Consumers: tools/scripts/_on_event_dispatch.sh

# Source guard
if [ -n "${_SKILL_EVENTS_LOADED:-}" ]; then return 0 2>/dev/null || exit 0; fi
_SKILL_EVENTS_LOADED=1

SKILL_EVENTS_CONFIG="${SKILL_EVENTS_CONFIG:-}"

# Resolve the config path relative to this library's own location
# (self-root contract: never trust an exported DEVENV_TOOLS blindly).
_skill_events_resolve_config() {
    if [ -n "$SKILL_EVENTS_CONFIG" ]; then
        echo "$SKILL_EVENTS_CONFIG"
        return 0
    fi
    local lib_dir
    lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    echo "$lib_dir/../config/skill-events.yml"
}

# Echo the Status token configured for the given event.
# Usage: event_status_for <event-name>
# Returns 1 (without output) when the event is not configured.
event_status_for() {
    local event="$1"
    local config
    config="$(_skill_events_resolve_config)"
    if [ ! -f "$config" ]; then
        return 1
    fi
    # Extract the status value under "  <event>:" in the events map.
    # yq-free: the schema is a flat two-level map with fixed indentation.
    local status
    status=$(awk -v ev="$event" '
        $0 ~ "^  " ev ":" { in_event=1; next }
        in_event && /^    status:/ { sub(/^    status:[ ]*/, ""); print; exit }
        in_event && /^  [^ ]/ { in_event=0 }
    ' "$config")
    if [ -z "$status" ]; then
        return 1
    fi
    echo "$status"
}

# Echo all configured event names, one per line.
event_names() {
    local config
    config="$(_skill_events_resolve_config)"
    if [ ! -f "$config" ]; then
        return 1
    fi
    # Stop at the first nested key line (two-space-indented, ends with ':')
    # AFTER collecting it - a nested "status:" line also matches the event
    # pattern, so anchor on the exact two-space indent of event keys only.
    awk '/^events:/ { in_events=1; next }
         in_events && /^    / { next }
         in_events && /^  [^ ]/ { sub(/^  /, ""); sub(/:$/, ""); print; next }
         in_events && /^[^ ]/ { exit }
    ' "$config"
}
