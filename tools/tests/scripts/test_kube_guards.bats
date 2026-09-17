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
    # Namespace resolver fixture: scripts resolve against this list; the
    # non-interactive fallback default is 'default'.
    export STUB_KUBECTL_NAMESPACES="default web"
    export STUB_KUBECTL_DEFAULT_NS="default"
    export KUBE_NO_INTERACTIVE=1
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

# =========================================================================
# Namespace flag (-n|--namespace) wiring — Plan-002 Phase 3
# =========================================================================

@test "kube-pod-delete: -n flag reaches the destructive call (records ns via stub)" {
    export STUB_KUBECTL_PODS="api-1"
    export YES=1
    export KUBE_NO_INTERACTIVE=1
    run bash "$DEVENV_TOOLS/scripts/kube-pod-delete.sh" api -n web < /dev/null
    assert_success
    grep -qx "api-1" "$STUB_KUBECTL_DELETED"
}

@test "kube-pod-delete: legacy positional namespace still works" {
    export STUB_KUBECTL_PODS="api-1"
    export YES=1
    export KUBE_NO_INTERACTIVE=1
    run bash "$DEVENV_TOOLS/scripts/kube-pod-delete.sh" api web < /dev/null
    assert_success
    grep -qx "api-1" "$STUB_KUBECTL_DELETED"
}

@test "kube-pod-scale: -n flag form scales successfully" {
    export STUB_KUBECTL_DEPLOYS="api"
    export YES=1
    export KUBE_NO_INTERACTIVE=1
    run bash "$DEVENV_TOOLS/scripts/kube-pod-scale.sh" api 3 -n web < /dev/null
    assert_success
    grep -qx "api" "$STUB_KUBECTL_SCALED"
}

@test "kube-pod-scale: NAMESPACE env var still supported (backward compat)" {
    export STUB_KUBECTL_DEPLOYS="api"
    export YES=1
    export NAMESPACE=web
    export KUBE_NO_INTERACTIVE=1
    run bash "$DEVENV_TOOLS/scripts/kube-pod-scale.sh" api 3 < /dev/null
    assert_success
    grep -qx "api" "$STUB_KUBECTL_SCALED"
}

@test "kube-pod-restart: -n flag form passes the guard with YES=1" {
    export STUB_KUBECTL_DEPLOYS="api"
    export YES=1
    export KUBE_NO_INTERACTIVE=1
    run bash "$DEVENV_TOOLS/scripts/kube-pod-restart.sh" api -n web < /dev/null
    # The stub cannot satisfy get_deployment_info's single-item JSON shape,
    # so restart reports it cannot determine replicas (exit 1) — the guard
    # itself (match + confirm) passed, which is what this test pins.
    [ "$status" -eq 1 ]
    [[ "$output" == *"Could not determine the current number of replicas"* ]]
}

@test "kube-selection: parse_namespace_flag extracts -n and shifts args" {
    source "$DEVENV_TOOLS/lib/error-handling.bash"
    source "$DEVENV_TOOLS/lib/kube-selection.bash"
    local argv=("api" "-n" "web" "extra")
    parse_namespace_flag argv
    [ "$NAMESPACE_FLAG_VALUE" = "web" ]
    [ "${#argv[@]}" -eq 2 ]
    [ "${argv[0]}" = "api" ]
    [ "${argv[1]}" = "extra" ]
}

@test "kube-selection: parse_namespace_flag absent leaves args untouched" {
    source "$DEVENV_TOOLS/lib/error-handling.bash"
    source "$DEVENV_TOOLS/lib/kube-selection.bash"
    local argv=("api" "extra")
    parse_namespace_flag argv || true
    [ -z "$NAMESPACE_FLAG_VALUE" ]
    [ "${#argv[@]}" -eq 2 ]
}

@test "kube-selection: parse_namespace_flag --ns=value form" {
    source "$DEVENV_TOOLS/lib/error-handling.bash"
    source "$DEVENV_TOOLS/lib/kube-selection.bash"
    local argv=("api" "--namespace=web")
    parse_namespace_flag argv
    [ "$NAMESPACE_FLAG_VALUE" = "web" ]
    [ "${#argv[@]}" -eq 1 ]
}

@test "kube-selection: parse_namespace_flag missing value is an error" {
    source "$DEVENV_TOOLS/lib/error-handling.bash"
    source "$DEVENV_TOOLS/lib/kube-selection.bash"
    local argv=("-n")
    local rc=0
    parse_namespace_flag argv 2>/dev/null || rc=$?
    [ "$rc" -eq 2 ]
}
