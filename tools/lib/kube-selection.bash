#!/bin/bash
# kube-selection.bash - Kubernetes selection and filtering library
# Version: 1.0.0
# Description: Centralized functions for Kubernetes resource selection and queries
# Requirements: Bash 4.0+, kubectl, jq, fzf (for interactive selection)
# Author: WorkInProgress.ai
# Last Modified: 2026-01-04

# Guard against multiple sourcing
if [ -n "${_KUBE_SELECTION_LOADED:-}" ]; then
    return 0
fi
_KUBE_SELECTION_LOADED=1

# Ensure error handling library is loaded
if [ -z "${_ERROR_HANDLING_LOADED:-}" ] && [ -f "${DEVENV_ROOT:-}/tools/lib/error-handling.bash" ]; then
    source "${DEVENV_ROOT:-}/tools/lib/error-handling.bash"
fi

# Ensure fzf-selection library is loaded
if [ -z "${_FZF_SELECTION_LOADED:-}" ] && [ -f "${DEVENV_ROOT:-}/tools/lib/fzf-selection.bash" ]; then
    source "${DEVENV_ROOT:-}/tools/lib/fzf-selection.bash"
fi

# ============================================================================
# Namespace Operations
# ============================================================================

# Get namespace option for kubectl commands
# Usage: get_namespace_option [NAMESPACE]
# Arguments:
#   NAMESPACE             Namespace name (optional, uses NAMESPACE env var if not provided)
# Returns: -n NAMESPACE if namespace specified, empty otherwise
# Example:
#   kubectl get pods $(get_namespace_option) -o json
get_namespace_option() {
    local ns="${1:-${NAMESPACE:-}}"
    if [ -n "$ns" ]; then
        echo "-n $ns"
    fi
}

# List all namespaces
# Usage: list_namespaces
# Returns: List of namespace names
# Example:
#   namespaces=$(list_namespaces)
list_namespaces() {
    kubectl get namespaces -o json | jq -r '.items[].metadata.name'
}

# Check if namespace exists
# Usage: namespace_exists NAMESPACE
# Arguments:
#   NAMESPACE             Namespace name to check
# Returns: 0 if exists, 1 if not
# Example:
#   if namespace_exists "default"; then echo "Found"; fi
namespace_exists() {
    local ns="$1"
    
    if [ -z "$ns" ]; then
        log_error "Namespace name is required"
        return 1
    fi
    
    kubectl get namespace "$ns" &>/dev/null
}

# ============================================================================
# Pod Operations
# ============================================================================

# List pods in namespace
# Usage: list_pods [--namespace NS] [--filter PATTERN]
# Arguments:
#   --namespace NS        Kubernetes namespace
#   --filter PATTERN      Regex pattern to filter pod names
# Returns: List of pod names
# Example:
#   pods=$(list_pods --namespace default --filter "web.*")
list_pods() {
    local ns="${NAMESPACE:-}"
    local pattern="${1:-.}"
    local ns_option=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --namespace|-n)
                ns="$2"
                shift 2
                ;;
            --filter|-f)
                pattern="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    [ -n "$ns" ] && ns_option="-n $ns"

    if [ -n "$pattern" ] && [ "$pattern" != "." ]; then
        # shellcheck disable=SC2086  # ns_option should not be quoted (can be empty)
        kubectl get pods $ns_option -o json | jq -r ".items[].metadata.name | select(test(\"$pattern\"))"
    else
        # shellcheck disable=SC2086  # ns_option should not be quoted (can be empty)
        kubectl get pods $ns_option -o json | jq -r '.items[].metadata.name'
    fi
}

# List deployments in namespace
# Usage: list_deployments [--namespace NS] [--filter PATTERN]
# Arguments:
#   --namespace NS        Kubernetes namespace
#   --filter PATTERN      Regex pattern to filter deployment names
# Returns: List of deployment names
# Example:
#   deployments=$(list_deployments --namespace default --filter "api.*")
list_deployments() {
    local ns="${NAMESPACE:-}"
    local pattern="${1:-.}"
    local ns_option=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --namespace|-n)
                ns="$2"
                shift 2
                ;;
            --filter|-f)
                pattern="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    [ -n "$ns" ] && ns_option="-n $ns"

    if [ -n "$pattern" ] && [ "$pattern" != "." ]; then
        # shellcheck disable=SC2086  # ns_option should not be quoted (can be empty)
        kubectl get deployments $ns_option -o json | jq -r ".items[].metadata.name | select(test(\"$pattern\"))"
    else
        # shellcheck disable=SC2086  # ns_option should not be quoted (can be empty)
        kubectl get deployments $ns_option --no-headers | awk '{print $1}'
    fi
}

# List statefulsets in namespace
# Usage: list_statefulsets [--namespace NS] [--filter PATTERN]
# Arguments:
#   --namespace NS        Kubernetes namespace
#   --filter PATTERN      Regex pattern to filter statefulset names
# Returns: List of statefulset names
# Example:
#   statefulsets=$(list_statefulsets --namespace default)
list_statefulsets() {
    local ns="${NAMESPACE:-}"
    local pattern="${1:-.}"
    local ns_option=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --namespace|-n)
                ns="$2"
                shift 2
                ;;
            --filter|-f)
                pattern="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    [ -n "$ns" ] && ns_option="-n $ns"

    if [ -n "$pattern" ] && [ "$pattern" != "." ]; then
        # shellcheck disable=SC2086  # ns_option should not be quoted (can be empty)
        kubectl get statefulsets $ns_option -o json | jq -r ".items[].metadata.name | select(test(\"$pattern\"))"
    else
        # shellcheck disable=SC2086  # ns_option should not be quoted (can be empty)
        kubectl get statefulsets $ns_option --no-headers | awk '{print $1}'
    fi
}

# ============================================================================
# Pod Selection with fzf
# ============================================================================

# Select pod with fzf
# Usage: select_pod_interactive [--namespace NS] [--filter PATTERN]
# Arguments:
#   --namespace NS        Kubernetes namespace
#   --filter PATTERN      Regex pattern to filter pod names
# Returns: Selected pod name
# Example:
#   pod=$(select_pod_interactive --namespace default)
select_pod_interactive() {
    local ns="${NAMESPACE:-}"
    local pattern=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --namespace|-n)
                ns="$2"
                shift 2
                ;;
            --filter|-f)
                pattern="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    check_fzf_installed || {
        log_error "fzf is required for interactive selection"
        return 1
    }

    local pods
    pods=$(list_pods --namespace "$ns" --filter "$pattern")
    
    if [ -z "$pods" ]; then
        log_error "No pods found"
        return 1
    fi

    if [ "$(echo "$pods" | wc -l)" -eq 1 ]; then
        echo "$pods"
        return 0
    fi

    # Multiple pods - use fzf for selection
    local selected
    selected=$(fzf_select_single "$pods" "Select pod: ")
    
    if ! fzf_validate_selection "$selected" "pod"; then
        return 1
    fi
    
    echo "$selected"
}

# ============================================================================
# Deployment Selection with fzf
# ============================================================================

# Select deployment with fzf
# Usage: select_deployment_interactive [--namespace NS] [--filter PATTERN]
# Arguments:
#   --namespace NS        Kubernetes namespace
#   --filter PATTERN      Regex pattern to filter deployment names
# Returns: Selected deployment name
# Example:
#   deployment=$(select_deployment_interactive --namespace default)
select_deployment_interactive() {
    local ns="${NAMESPACE:-}"
    local pattern=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --namespace|-n)
                ns="$2"
                shift 2
                ;;
            --filter|-f)
                pattern="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    check_fzf_installed || {
        log_error "fzf is required for interactive selection"
        return 1
    }

    local deployments
    deployments=$(list_deployments --namespace "$ns" --filter "$pattern")
    
    if [ -z "$deployments" ]; then
        log_error "No deployments found"
        return 1
    fi

    if [ "$(echo "$deployments" | wc -l)" -eq 1 ]; then
        echo "$deployments"
        return 0
    fi

    # Multiple deployments - use fzf for selection
    local selected
    selected=$(fzf_select_single "$deployments" "Select deployment: ")
    
    if ! fzf_validate_selection "$selected" "deployment"; then
        return 1
    fi
    
    echo "$selected"
}

# ============================================================================
# Resource Existence Checks
# ============================================================================

# Check if pod exists
# Usage: pod_exists [--namespace NS] POD_NAME
# Arguments:
#   --namespace NS        Kubernetes namespace
#   POD_NAME              Name of pod to check
# Returns: 0 if exists, 1 if not
# Example:
#   if pod_exists --namespace default my-pod; then echo "Found"; fi
pod_exists() {
    local ns="${NAMESPACE:-}"
    local pod=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --namespace|-n)
                ns="$2"
                shift 2
                ;;
            *)
                pod="$1"
                shift
                ;;
        esac
    done

    if [ -z "$pod" ]; then
        log_error "Pod name is required"
        return 1
    fi

    local ns_option=""
    [ -n "$ns" ] && ns_option="-n $ns"

    # shellcheck disable=SC2086  # ns_option should not be quoted (can be empty)
    kubectl get pod "$pod" $ns_option &>/dev/null
}

# Check if deployment exists
# Usage: deployment_exists [--namespace NS] DEPLOYMENT_NAME
# Arguments:
#   --namespace NS        Kubernetes namespace
#   DEPLOYMENT_NAME       Name of deployment to check
# Returns: 0 if exists, 1 if not
# Example:
#   if deployment_exists --namespace default my-app; then echo "Found"; fi
deployment_exists() {
    local ns="${NAMESPACE:-}"
    local deployment=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --namespace|-n)
                ns="$2"
                shift 2
                ;;
            *)
                deployment="$1"
                shift
                ;;
        esac
    done

    if [ -z "$deployment" ]; then
        log_error "Deployment name is required"
        return 1
    fi

    local ns_option=""
    [ -n "$ns" ] && ns_option="-n $ns"

    # shellcheck disable=SC2086  # ns_option should not be quoted (can be empty)
    kubectl get deployment "$deployment" $ns_option &>/dev/null
}

# ============================================================================
# Resource Information
# ============================================================================

# Get pod info as JSON
# Usage: get_pod_info [--namespace NS] POD_NAME
# Arguments:
#   --namespace NS        Kubernetes namespace
#   POD_NAME              Name of pod
# Returns: Pod info as JSON
# Example:
#   info=$(get_pod_info --namespace default my-pod)
get_pod_info() {
    local ns="${NAMESPACE:-}"
    local pod=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --namespace|-n)
                ns="$2"
                shift 2
                ;;
            *)
                pod="$1"
                shift
                ;;
        esac
    done

    if [ -z "$pod" ]; then
        log_error "Pod name is required"
        return 1
    fi

    local ns_option=""
    [ -n "$ns" ] && ns_option="-n $ns"

    # shellcheck disable=SC2086  # ns_option should not be quoted (can be empty)
    kubectl get pod "$pod" $ns_option -o json
}

# Get deployment info as JSON
# Usage: get_deployment_info [--namespace NS] DEPLOYMENT_NAME
# Arguments:
#   --namespace NS        Kubernetes namespace
#   DEPLOYMENT_NAME       Name of deployment
# Returns: Deployment info as JSON
# Example:
#   info=$(get_deployment_info --namespace default my-app)
get_deployment_info() {
    local ns="${NAMESPACE:-}"
    local deployment=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --namespace|-n)
                ns="$2"
                shift 2
                ;;
            *)
                deployment="$1"
                shift
                ;;
        esac
    done

    if [ -z "$deployment" ]; then
        log_error "Deployment name is required"
        return 1
    fi

    local ns_option=""
    [ -n "$ns" ] && ns_option="-n $ns"

    # shellcheck disable=SC2086  # ns_option should not be quoted (can be empty)
    kubectl get deployment "$deployment" $ns_option -o json
}

# ============================================================================
# Context Operations
# ============================================================================

# List available contexts
# Usage: list_contexts
# Returns: List of context names
# Example:
#   contexts=$(list_contexts)
list_contexts() {
    kubectl config get-contexts --no-headers | awk '{print $1}'
}

# Get current context
# Usage: get_current_context
# Returns: Current context name
# Example:
#   context=$(get_current_context)
get_current_context() {
    kubectl config current-context
}

# Select context with fzf
# Usage: select_context_interactive
# Returns: Selected context name
# Example:
#   context=$(select_context_interactive)
select_context_interactive() {
    check_fzf_installed || {
        log_error "fzf is required for interactive selection"
        return 1
    }

    local contexts
    contexts=$(list_contexts)
    
    if [ -z "$contexts" ]; then
        log_error "No contexts found"
        return 1
    fi

    if [ "$(echo "$contexts" | wc -l)" -eq 1 ]; then
        echo "$contexts"
        return 0
    fi

    # Multiple contexts - use fzf for selection
    local selected
    selected=$(fzf_select_single "$contexts" "Select context: ")
    
    if ! fzf_validate_selection "$selected" "context"; then
        return 1
    fi
    
    echo "$selected"
}

# Export functions
export -f get_namespace_option
export -f list_namespaces
export -f namespace_exists
export -f list_pods
export -f list_deployments
export -f list_statefulsets
export -f select_pod_interactive
export -f select_deployment_interactive
export -f pod_exists
export -f deployment_exists
export -f get_pod_info
export -f get_deployment_info
export -f list_contexts
export -f get_current_context
export -f select_context_interactive
