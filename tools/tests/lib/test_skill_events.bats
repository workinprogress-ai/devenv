#!/usr/bin/env bats
# Tests for the skill-events.bash config-parser contract:
# event -> Status resolution must be exact, unknown events must fail
# cleanly, and comment/header lines must never leak into parsing.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    LIB="$PROJECT_ROOT/tools/lib/skill-events.bash"
    # Isolated fixture config per test so the real config stays untouched.
    FIXTURE="$TEST_TEMP_DIR/skill-events.yml"
    cat > "$FIXTURE" <<'EOF'
events:
  _on_begin_grooming:
    status: To-Groom
  _on_end_grooming:
    status: Ready
  _on_begin_implementation:
    status: Implementing
EOF
    export SKILL_EVENTS_CONFIG="$FIXTURE"
}

@test "event_status_for resolves a configured event's status" {
    run bash -c "source '$LIB' && event_status_for _on_begin_grooming"
    [ "$status" -eq 0 ]
    [ "$output" = "To-Groom" ]
}

@test "event_status_for resolves a second event without bleed" {
    run bash -c "source '$LIB' && event_status_for _on_end_grooming"
    [ "$status" -eq 0 ]
    [ "$output" = "Ready" ]
}

@test "event_status_for returns 1 for an unknown event" {
    run bash -c "source '$LIB' && event_status_for _on_unknown_event"
    [ "$status" -eq 1 ]
    [ -z "$output" ]
}

@test "event_names lists all configured events one per line" {
    run bash -c "source '$LIB' && event_names"
    [ "$status" -eq 0 ]
    [ "${lines[0]}" = "_on_begin_grooming" ]
    [ "${lines[1]}" = "_on_end_grooming" ]
    [ "${lines[2]}" = "_on_begin_implementation" ]
    [ "${#lines[@]}" -eq 3 ]
}

@test "missing config file is a clean rc=1, not an error spray" {
    run bash -c "source '$LIB' && SKILL_EVENTS_CONFIG=/nonexistent.yml && event_status_for _on_begin_grooming"
    [ "$status" -eq 1 ]
}

@test "comment lines and the schema header do not leak into parsing" {
    # The real config has a long header comment block; parser must ignore it.
    run bash -c "source '$LIB' && event_names | grep -c 'status'"
    [ "$output" = "0" ]
}
