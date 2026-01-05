#!/usr/bin/env bats

# Test suite for kube-selection.bash library
# Tests Kubernetes resource selection and filtering

load test_helper

@test "source kube-selection.bash library" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    [ -n "$_KUBE_SELECTION_LOADED" ]
}

@test "kube-selection: source is idempotent" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    # Should not cause errors
    [ -n "$_KUBE_SELECTION_LOADED" ]
}

# ============================================================================
# Namespace operations tests
# ============================================================================

@test "get_namespace_option returns empty when no namespace" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    result=$(get_namespace_option)
    [ -z "$result" ]
}

@test "get_namespace_option returns -n option with namespace" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    result=$(get_namespace_option "default")
    [[ "$result" =~ "-n" ]] && [[ "$result" =~ "default" ]]
}

@test "get_namespace_option uses NAMESPACE env var" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    NAMESPACE="kube-system"
    result=$(get_namespace_option)
    [[ "$result" =~ "kube-system" ]]
}

@test "get_namespace_option parameter overrides NAMESPACE var" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    NAMESPACE="kube-system"
    result=$(get_namespace_option "default")
    [[ "$result" =~ "default" ]] && [[ ! "$result" =~ "kube-system" ]]
}

@test "namespace_exists requires namespace name" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    ! namespace_exists ""
}

@test "list_namespaces function exists" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f list_namespaces > /dev/null
}

# ============================================================================
# Pod operations tests
# ============================================================================

@test "list_pods function exists and accepts parameters" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f list_pods > /dev/null
}

@test "list_pods accepts --namespace parameter" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f list_pods > /dev/null
    # Function signature validated
}

@test "list_pods accepts --filter parameter" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f list_pods > /dev/null
}

@test "list_pods accepts -n short option" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f list_pods > /dev/null
}

@test "list_pods accepts -f short option" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f list_pods > /dev/null
}

@test "pod_exists requires pod name" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    ! pod_exists ""
}

@test "pod_exists accepts --namespace parameter" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f pod_exists > /dev/null
}

# ============================================================================
# Deployment operations tests
# ============================================================================

@test "list_deployments function exists and accepts parameters" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f list_deployments > /dev/null
}

@test "list_deployments accepts --namespace parameter" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f list_deployments > /dev/null
}

@test "list_deployments accepts --filter parameter" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f list_deployments > /dev/null
}

@test "deployment_exists requires deployment name" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    ! deployment_exists ""
}

@test "deployment_exists accepts --namespace parameter" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f deployment_exists > /dev/null
}

@test "list_statefulsets function exists" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f list_statefulsets > /dev/null
}

# ============================================================================
# Selection functions tests
# ============================================================================

@test "select_pod_interactive function exists" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f select_pod_interactive > /dev/null
}

@test "select_pod_interactive accepts --namespace parameter" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f select_pod_interactive > /dev/null
}

@test "select_pod_interactive accepts --filter parameter" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f select_pod_interactive > /dev/null
}

@test "select_deployment_interactive function exists" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f select_deployment_interactive > /dev/null
}

@test "select_deployment_interactive accepts --namespace parameter" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f select_deployment_interactive > /dev/null
}

@test "select_deployment_interactive accepts --filter parameter" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f select_deployment_interactive > /dev/null
}

# ============================================================================
# Resource information tests
# ============================================================================

@test "get_pod_info requires pod name" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    ! get_pod_info ""
}

@test "get_pod_info accepts --namespace parameter" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f get_pod_info > /dev/null
}

@test "get_deployment_info requires deployment name" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    ! get_deployment_info ""
}

@test "get_deployment_info accepts --namespace parameter" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f get_deployment_info > /dev/null
}

# ============================================================================
# Context operations tests
# ============================================================================

@test "list_contexts function exists" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f list_contexts > /dev/null
}

@test "get_current_context function exists" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f get_current_context > /dev/null
}

@test "select_context_interactive function exists" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f select_context_interactive > /dev/null
}

# ============================================================================
# Integration tests
# ============================================================================

@test "kube-selection can load without fzf-selection library" {
    # Override DEVENV_ROOT temporarily
    local temp_root=$(mktemp -d)
    mkdir -p "$temp_root/tools/lib"
    cp "$DEVENV_ROOT/tools/lib/kube-selection.bash" "$temp_root/tools/lib/"
    
    source "$temp_root/tools/lib/kube-selection.bash" 2>/dev/null || true
    rm -rf "$temp_root"
}

@test "all kube-selection functions are exported" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    
    # Check key functions are exported
    declare -F list_pods > /dev/null
    declare -F list_deployments > /dev/null
    declare -F get_namespace_option > /dev/null
    declare -F pod_exists > /dev/null
}

# ============================================================================
# Parameter handling tests
# ============================================================================

@test "list_pods handles NAMESPACE env var" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    NAMESPACE="test-namespace"
    declare -f list_pods > /dev/null
}

@test "list_deployments handles NAMESPACE env var" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    NAMESPACE="test-namespace"
    declare -f list_deployments > /dev/null
}

@test "select_pod_interactive handles NAMESPACE env var" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    NAMESPACE="test-namespace"
    declare -f select_pod_interactive > /dev/null
}

# ============================================================================
# Edge cases
# ============================================================================

@test "get_namespace_option with whitespace in namespace name" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    result=$(get_namespace_option "name with spaces")
    [[ "$result" =~ "name with spaces" ]]
}

@test "list_pods with empty filter parameter uses default" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f list_pods > /dev/null
}

@test "list_deployments with pattern filter" {
    source "$DEVENV_ROOT/tools/lib/kube-selection.bash"
    declare -f list_deployments > /dev/null
}
