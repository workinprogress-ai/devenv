#!/usr/bin/env bats
# Contract tests for the _on_* event dispatcher (task 2.3).
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

@test "dispatcher: unknown event warns and exits 0 (D-008 tolerance)" {
    run bash "$DISPATCH" _on_unknown_event 42
    [ "$status" -eq 0 ]
    [[ "$output" == *"Unknown event"* ]]
}

@test "dispatcher: configured event reports resolved status (contract report mode)" {
    run bash "$DISPATCH" _on_begin_grooming 42
    [ "$status" -eq 0 ]
    [[ "$output" == *"_on_begin_grooming"* ]]
    [[ "$output" == *"To-Groom"* ]]
}

@test "dispatcher: missing issue number is a usage error" {
    run bash "$DISPATCH" _on_begin_grooming
    [ "$status" -ne 0 ]
}
