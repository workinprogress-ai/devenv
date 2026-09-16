#!/usr/bin/env bats
# Guard-behavior tests for kube-pod-delete / kube-pod-scale / kube-pod-restart
# and the shared kube-selection resolve_single_match helper (Plan-001 3.6).
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
    export DEVENV_TOOLS="$PROJECT_ROOT/tools"
}

@test "kube-selection: resolve_single_match returns the single match" {
    source "$DEVENV_TOOLS/lib/error-handling.bash"
    source "$DEVENV_TOOLS/lib/kube-selection.bash"
    export STUB_KUBECTL_PODS="web-1"
    run resolve_single_match list_pods --filter "web"
    assert_success
    [ "$output" = "web-1" ]
}

@test "kube-selection: resolve_single_match exits 3 listing multiple candidates" {
    source "$DEVENV_TOOLS/lib/error-handling.bash"
    source "$DEVENV_TOOLS/lib/kube-selection.bash"
    export STUB_KUBECTL_PODS=$'web-1\nweb-2'
    run resolve_single_match list_pods --filter "web"
    [ "$status" -eq 3 ]
    [[ "$output" == *"web-1"* ]]
    [[ "$output" == *"web-2"* ]]
}

@test "kube-selection: resolve_single_match exits 2 on zero matches" {
    source "$DEVENV_TOOLS/lib/error-handling.bash"
    source "$DEVENV_TOOLS/lib/kube-selection.bash"
    export STUB_KUBECTL_PODS="web-1"
    run resolve_single_match list_pods --filter "nomatch"
    [ "$status" -eq 2 ]
}

@test "kube-selection: filter regex metacharacters do not break the jq program" {
    source "$DEVENV_TOOLS/lib/error-handling.bash"
    source "$DEVENV_TOOLS/lib/kube-selection.bash"
    export STUB_KUBECTL_PODS=$'web(1)\nweb-2'
    run resolve_single_match list_pods --filter 'web\(1\)'
    assert_success
    [ "$output" = "web(1)" ]
}

@test "kube-pod-delete: refuses multi-match without deleting anything" {
    export STUB_KUBECTL_PODS=$'api-1\napi-2'
    run bash "$DEVENV_TOOLS/scripts/kube-pod-delete.sh" api <<< ""
    [ "$status" -eq 3 ]
    [ ! -s "$STUB_KUBECTL_DELETED" ]
}

@test "kube-pod-delete: refuses non-interactive run without YES" {
    export STUB_KUBECTL_PODS="api-1"
    run bash "$DEVENV_TOOLS/scripts/kube-pod-delete.sh" api < /dev/null
    [ "$status" -eq 2 ]
    [ ! -s "$STUB_KUBECTL_DELETED" ]
}

@test "kube-pod-delete: deletes the single match with YES=1" {
    export STUB_KUBECTL_PODS="api-1"
    export YES=1
    run bash "$DEVENV_TOOLS/scripts/kube-pod-delete.sh" api < /dev/null
    assert_success
    grep -qx "api-1" "$STUB_KUBECTL_DELETED"
}

@test "kube-pod-scale: validates replicas are numeric before kubectl" {
    export STUB_KUBECTL_DEPLOYS="api"
    run bash "$DEVENV_TOOLS/scripts/kube-pod-scale.sh" api abc < /dev/null
    [ "$status" -eq 2 ]
    [ ! -s "$STUB_KUBECTL_SCALED" ]
}

@test "kube-pod-scale: refuses multi-match without scaling" {
    export STUB_KUBECTL_DEPLOYS=$'api-1\napi-2'
    run bash "$DEVENV_TOOLS/scripts/kube-pod-scale.sh" api 3 < /dev/null
    [ "$status" -eq 3 ]
    [ ! -s "$STUB_KUBECTL_SCALED" ]
}

@test "kube-pod-scale: refuses non-interactive run without YES" {
    export STUB_KUBECTL_DEPLOYS="api"
    run bash "$DEVENV_TOOLS/scripts/kube-pod-scale.sh" api 3 < /dev/null
    [ "$status" -eq 2 ]
    [ ! -s "$STUB_KUBECTL_SCALED" ]
}

@test "kube-pod-scale: scales the single match with YES=1" {
    export STUB_KUBECTL_DEPLOYS="api"
    export YES=1
    run bash "$DEVENV_TOOLS/scripts/kube-pod-scale.sh" api 3 < /dev/null
    assert_success
    grep -qx "api" "$STUB_KUBECTL_SCALED"
}

@test "kube-pod-restart: refuses multi-match without restarting" {
    export STUB_KUBECTL_DEPLOYS=$'api-1\napi-2'
    export YES=1
    run bash "$DEVENV_TOOLS/scripts/kube-pod-restart.sh" api < /dev/null
    [ "$status" -eq 3 ]
    # No scale-to-0 may have been issued for any candidate
    [ ! -s "$STUB_KUBECTL_SCALED" ]
}

@test "kube-pod-restart: refuses non-interactive run without YES" {
    export STUB_KUBECTL_DEPLOYS="api"
    run bash "$DEVENV_TOOLS/scripts/kube-pod-restart.sh" api < /dev/null
    [ "$status" -eq 2 ]
    [ ! -s "$STUB_KUBECTL_SCALED" ]
}
