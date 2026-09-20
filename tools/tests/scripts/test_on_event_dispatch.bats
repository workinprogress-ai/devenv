#!/usr/bin/env bats
# Contract tests for the _on_* event dispatcher.
# Locks the dispatcher's observable contract for skill callers:
# unknown events never fail, and configured flows always exit 0.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    DISPATCH="$PROJECT_ROOT/tools/scripts/_on_event_dispatch.sh"
}

@test "dispatcher: no args is a usage error" {
    run bash "$DISPATCH"
    [ "$status" -ne 0 ]
    [[ "$output" == *"Usage"* ]]
}

@test "dispatcher: unknown event warns and exits 0 (tolerance)" {
    run bash "$DISPATCH" _on_unknown_event 42
    [ "$status" -eq 0 ]
    [[ "$output" == *"Unknown event"* ]]
}

@test "dispatcher: configured event succeeds quietly via the workflow library" {
    # The shim delegates to workflow_on_event: rc 0, no error output on the
    # happy path (write noise is suppressed; failures warn instead of
    # blocking skill work).
    run bash "$DISPATCH" _on_begin_grooming 42
    [ "$status" -eq 0 ]
    [[ "$output" != *"Unknown event"* ]]
}

@test "dispatcher: missing issue number is a usage error" {
    run bash "$DISPATCH" _on_begin_grooming
    [ "$status" -ne 0 ]
}
