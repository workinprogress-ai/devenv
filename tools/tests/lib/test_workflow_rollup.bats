#!/usr/bin/env bats
# Tests for the pure min-rollup function (workflow_compute_rollup).
# Every row of the scenario table in docs/Issue-Workflow.md, plus
# order-sensitivity. Pure function: no stubs needed.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    LIB="$PROJECT_ROOT/tools/lib/workflow-core.bash"
}

rollup() {
    bash -c "source '$LIB' && workflow_compute_rollup $*"
}

@test "all children pre-delivery -> rollup fails (parent keeps own state; caller decides)" {
    # The function is undefined for all-pre-delivery sets: it returns non-zero
    # so the caller knows to leave the parent's own state untouched.
    run rollup '"Ready"' '"Ready"'
    [ "$status" -ne 0 ]
}

@test "no children -> rollup fails (nothing to derive)" {
    run rollup
    [ "$status" -ne 0 ]
}

@test "{Implementing,Ready,Ready} -> Implementing (floor + first activation)" {
    run rollup '"Implementing"' '"Ready"' '"Ready"'
    [ "$status" -eq 0 ]
    [ "$output" = "Implementing" ]
}

@test "{Implementing,Implementing,Review} -> Implementing (last-to-review rule)" {
    run rollup '"Implementing"' '"Implementing"' '"Review"'
    [ "$status" -eq 0 ]
    [ "$output" = "Implementing" ]
}

@test "{Merged,Merged,Review} -> Review" {
    run rollup '"Merged"' '"Merged"' '"Review"'
    [ "$status" -eq 0 ]
    [ "$output" = "Review" ]
}

@test "{Production,Review,Merged} -> Review (typo-corrected scenario)" {
    run rollup '"Production"' '"Review"' '"Merged"'
    [ "$status" -eq 0 ]
    [ "$output" = "Review" ]
}

@test "{Review,new-Ready} -> Implementing (new child pulls parent back)" {
    run rollup '"Review"' '"Ready"'
    [ "$status" -eq 0 ]
    [ "$output" = "Implementing" ]
}

@test "{Implementing(regressed),Merged} -> Implementing (sanctioned regression)" {
    run rollup '"Implementing"' '"Merged"'
    [ "$status" -eq 0 ]
    [ "$output" = "Implementing" ]
}

@test "{Production,Staging} -> Staging" {
    run rollup '"Production"' '"Staging"'
    [ "$status" -eq 0 ]
    [ "$output" = "Staging" ]
}

@test "unknown child status -> rollup fails (vocabulary mismatch is an error)" {
    run rollup '"Bogus"'
    [ "$status" -ne 0 ]
}

@test "order-sensitivity: reordered vocabulary changes the min" {
    # Pin that min derives from config order, not a hardcoded list. The
    # reorder must stay semantically valid: Implementing remains the first
    # delivery state and the reorder only swaps two delivery states
    # (Review before Merged), so min({Review,Merged}) flips to Merged.
    run bash -c "
        source '$LIB'
        WORKFLOW_ORDER_OVERRIDE='TBD,To-Groom,Ready,Implementing,Review,Merged,Staging,Production'
        workflow_compute_rollup 'Review' 'Merged'
    "
    [ "$status" -eq 0 ]
    [ "$output" = "Review" ]
    run bash -c "
        source '$LIB'
        WORKFLOW_ORDER_OVERRIDE='TBD,To-Groom,Ready,Implementing,Merged,Review,Staging,Production'
        workflow_compute_rollup 'Review' 'Merged'
    "
    [ "$status" -eq 0 ]
    [ "$output" = "Merged" ]
}
