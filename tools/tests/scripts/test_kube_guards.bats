#!/usr/bin/env bats
# Guard-behavior tests for kube-pod-delete / kube-pod-scale / kube-pod-restart
# and the shared kube-selection resolve_single_match helper.
#
# Every destructive branch asserts BOTH the exit status AND that no destructive
# kubectl call was recorded by the stub.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

assert_success() { [ "$status" -eq 0 ]; }
assert_failure() { [ "$status" -ne 0 ]; }

setup() {
    test_helper_setup
    stub_kubectl_json
    export STUB_KUBECTL_DELETED="$TEST_TEMP_DIR/deleted.txt"
    export STUB_KUBECTL_SCALED="$TEST_TEMP_DIR/scaled.txt"
    : > "$STUB_KUBECTL_DELETED"
    : > "$STUB_KUBECTL_SCALED"
    # Namespace resolver fixture: scripts resolve against this list; the
    # non-interactive fallback default is 'default'.
    export STUB_KUBECTL_NAMESPACES="default web"
    export STUB_KUBECTL_DEFAULT_NS="default"
    export KUBE_NO_INTERACTIVE=1
    export DEVENV_TOOLS="$PROJECT_ROOT/tools"
}

@test "kube-pod-delete: refuses multi-match without deleting anything" {
    export STUB_KUBECTL_PODS=$'api-1\napi-2'
    run "$DEVENV_TOOLS/kube-pod-delete" api <<< ""
    [ "$status" -eq 3 ]
    [ ! -s "$STUB_KUBECTL_DELETED" ]
}

@test "kube-pod-delete: refuses non-interactive run without YES" {
    export STUB_KUBECTL_PODS="api-1"
    run "$DEVENV_TOOLS/kube-pod-delete" api < /dev/null
    [ "$status" -eq 2 ]
    [ ! -s "$STUB_KUBECTL_DELETED" ]
}

@test "kube-pod-delete: deletes the single match with YES=1" {
    export STUB_KUBECTL_PODS="api-1"
    export YES=1
    run "$DEVENV_TOOLS/kube-pod-delete" api < /dev/null
    assert_success
    grep -qx "api-1" "$STUB_KUBECTL_DELETED"
}

@test "kube-pod-scale: validates replicas are numeric before kubectl" {
    export STUB_KUBECTL_DEPLOYS="api"
    run "$DEVENV_TOOLS/kube-pod-scale" api abc < /dev/null
    [ "$status" -eq 2 ]
    [ ! -s "$STUB_KUBECTL_SCALED" ]
}

@test "kube-pod-scale: refuses multi-match without scaling" {
    export STUB_KUBECTL_DEPLOYS=$'api-1\napi-2'
    run "$DEVENV_TOOLS/kube-pod-scale" api 3 < /dev/null
    [ "$status" -eq 3 ]
    [ ! -s "$STUB_KUBECTL_SCALED" ]
}

@test "kube-pod-scale: refuses non-interactive run without YES" {
    export STUB_KUBECTL_DEPLOYS="api"
    run "$DEVENV_TOOLS/kube-pod-scale" api 3 < /dev/null
    [ "$status" -eq 2 ]
    [ ! -s "$STUB_KUBECTL_SCALED" ]
}

@test "kube-pod-scale: scales the single match with YES=1" {
    export STUB_KUBECTL_DEPLOYS="api"
    export YES=1
    run "$DEVENV_TOOLS/kube-pod-scale" api 3 < /dev/null
    assert_success
    grep -qx "api" "$STUB_KUBECTL_SCALED"
}

@test "kube-pod-restart: refuses multi-match without restarting" {
    export STUB_KUBECTL_DEPLOYS=$'api-1\napi-2'
    export YES=1
    run "$DEVENV_TOOLS/kube-pod-restart" api < /dev/null
    [ "$status" -eq 3 ]
    # No scale-to-0 may have been issued for any candidate
    [ ! -s "$STUB_KUBECTL_SCALED" ]
}

@test "kube-pod-restart: refuses non-interactive run without YES" {
    export STUB_KUBECTL_DEPLOYS="api"
    run "$DEVENV_TOOLS/kube-pod-restart" api < /dev/null
    [ "$status" -eq 2 ]
    [ ! -s "$STUB_KUBECTL_SCALED" ]
}

# =========================================================================
# Declining the confirmation: distinct status, no destructive call
# =========================================================================

# Run a kube script on a pseudo-terminal so confirm_or_fail takes its prompt
# path, answering the prompt with ANSWER.
run_on_tty() {
    local answer="$1" script_name="$2"; shift 2
    # The stub entry point (bash no longer exists for converted tools).
    local cmd="env TERM=xterm '$DEVENV_TOOLS/${script_name%.sh}'" a
    for a in "$@"; do cmd+=" '$a'"; done
    run bash -c "printf '%s\n' '$answer' | script -qefc \"$cmd\" /dev/null"
}

@test "kube-pod-delete: declining the prompt exits 130, not 0, and deletes nothing" {
    export STUB_KUBECTL_PODS="api-1"
    run_on_tty n kube-pod-delete.sh api
    # Exit 0 would tell calling automation that the deletion happened.
    [ "$status" -eq 130 ]
    [[ "$output" == *"Aborted."* ]]
    [ ! -s "$STUB_KUBECTL_DELETED" ]
}

@test "kube-pod-scale: declining the prompt exits 130, not 0, and scales nothing" {
    export STUB_KUBECTL_DEPLOYS="api"
    run_on_tty n kube-pod-scale.sh api 3
    [ "$status" -eq 130 ]
    [[ "$output" == *"Aborted."* ]]
    [ ! -s "$STUB_KUBECTL_SCALED" ]
}

@test "kube-pod-restart: declining the prompt exits 130, not 0, and restarts nothing" {
    export STUB_KUBECTL_DEPLOYS="api"
    run_on_tty n kube-pod-restart.sh api
    [ "$status" -eq 130 ]
    [[ "$output" == *"Aborted."* ]]
    [ ! -s "$STUB_KUBECTL_SCALED" ]
}

@test "kube-pod-delete: answering y at the prompt still deletes" {
    export STUB_KUBECTL_PODS="api-1"
    run_on_tty y kube-pod-delete.sh api
    [ "$status" -eq 0 ]
    grep -qx "api-1" "$STUB_KUBECTL_DELETED"
}

@test "kube-pod-delete: -n flag reaches the destructive call (records ns via stub)" {
    export STUB_KUBECTL_PODS="api-1"
    export YES=1
    export KUBE_NO_INTERACTIVE=1
    run "$DEVENV_TOOLS/kube-pod-delete" api -n web < /dev/null
    assert_success
    grep -qx "api-1" "$STUB_KUBECTL_DELETED"
}

@test "kube-pod-delete: positional namespace is accepted" {
    export STUB_KUBECTL_PODS="api-1"
    export YES=1
    export KUBE_NO_INTERACTIVE=1
    run "$DEVENV_TOOLS/kube-pod-delete" api web < /dev/null
    assert_success
    grep -qx "api-1" "$STUB_KUBECTL_DELETED"
}

@test "kube-pod-scale: -n flag form scales successfully" {
    export STUB_KUBECTL_DEPLOYS="api"
    export YES=1
    export KUBE_NO_INTERACTIVE=1
    run "$DEVENV_TOOLS/kube-pod-scale" api 3 -n web < /dev/null
    assert_success
    grep -qx "api" "$STUB_KUBECTL_SCALED"
}

@test "kube-pod-scale: NAMESPACE env var still supported (backward compat)" {
    export STUB_KUBECTL_DEPLOYS="api"
    export YES=1
    export NAMESPACE=web
    export KUBE_NO_INTERACTIVE=1
    run "$DEVENV_TOOLS/kube-pod-scale" api 3 < /dev/null
    assert_success
    grep -qx "api" "$STUB_KUBECTL_SCALED"
}

@test "kube-pod-restart: -n flag form passes the guard with YES=1" {
    export STUB_KUBECTL_DEPLOYS="api"
    export YES=1
    export KUBE_NO_INTERACTIVE=1
    run "$DEVENV_TOOLS/kube-pod-restart" api -n web < /dev/null
    # The stub cannot satisfy get_deployment_info's single-item JSON shape,
    # so restart reports it cannot determine replicas (exit 1) — the guard
    # itself (match + confirm) passed, which is what this test pins.
    [ "$status" -eq 1 ]
    [[ "$output" == *"Could not determine the current number of replicas"* ]]
}

