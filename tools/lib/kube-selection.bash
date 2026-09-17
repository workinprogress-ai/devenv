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

# Extract -n|--namespace <ns> from the argument list (in-place via nameref).
# Usage: parse_namespace_flag ARGS_ARRAY_NAME
#   e.g.  parse_namespace_flag argv   →  sets NAMESPACE_FLAG_VALUE, shifts argv
# Returns 0 if a flag was found (NAMESPACE_FLAG_VALUE set, array shifted),
# 1 if absent (NAMESPACE_FLAG_VALUE empty, array untouched).
parse_namespace_flag() {
    local -n _argv="$1"
    # shellcheck disable=SC2034  # NAMESPACE_FLAG_VALUE is the caller-read output variable
    NAMESPACE_FLAG_VALUE=""
    local i
    for i in "${!_argv[@]}"; do
        case "${_argv[$i]}" in
            -n|--namespace)
                if [ -z "${_argv[$((i + 1))]:-}" ]; then
                    log_error "--namespace flag requires a value"
                    return 2
                fi
                NAMESPACE_FLAG_VALUE="${_argv[$((i + 1))]}"
                unset '_argv[$i]' '_argv[$((i + 1))]'
                _argv=("${_argv[@]}")
                return 0
                ;;
            -n=*|--namespace=*)
                # shellcheck disable=SC2034  # output variable, read by caller
                NAMESPACE_FLAG_VALUE="${_argv[$i]#*=}"
                unset '_argv[$i]'
                _argv=("${_argv[@]}")
                return 0
                ;;
        esac
    done
    return 1
}

# Testable interactivity guard for selection paths.
# True when: stdin is a TTY, fzf is available, and KUBE_NO_INTERACTIVE is unset/0.
# KUBE_NO_INTERACTIVE=1 forces non-interactive behavior (used by tests and
# scriptable environments) without relying on TTY detection alone.
_kube_interactive() {
    [ "${KUBE_NO_INTERACTIVE:-0}" != "1" ] && [ -t 0 ] && command -v fzf >/dev/null 2>&1
}

# Resolve a namespace from explicit arg, env var, or interactive picker.
# Usage: resolve_namespace [ARG_NAMESPACE]
# Arguments:
#   ARG_NAMESPACE          Explicit namespace (e.g. from -n/--namespace flag or
#                          positional argument). Optional.
# Environment:
#   NAMESPACE              Fallback when no arg is given (existing convention).
# Returns:
#   0 and echoes the resolved namespace name.
#   1 when no namespace can be resolved non-interactively AND kubectl has no
#     default (rare; kubectl almost always has a context default).
# Resolution order:
#   1. Explicit argument
#   2. NAMESPACE env var
#   3. Partial-match resolution (arg or env): case-insensitive substring match
#      against the namespace list — unique hit auto-selects, multiple hits
#      offer an fzf-filtered menu (TTY) or error listing candidates (non-TTY),
#      zero hits errors listing candidates.
#   4. Nothing given + TTY: fzf picker over all namespaces.
#   5. Nothing given + non-TTY: kubectl current-context default, with a
#      one-line hint that -n or the picker exists.
# Example:
#   NS=$(resolve_namespace "$wanted_ns") || exit $?
resolve_namespace() {
    local arg_ns="${1:-}"
    local candidate="${arg_ns:-${NAMESPACE:-}}"

    # Exact match fast path (also covers arg/env given verbatim).
    if [ -n "$candidate" ] && namespace_exists "$candidate" 2>/dev/null; then
        echo "$candidate"
        return 0
    fi

    local all_ns
    all_ns=$(list_namespaces 2>/dev/null) || {
        log_error "Could not list namespaces (kubectl cluster unreachable?)"
        return 1
    }
    if [ -z "$all_ns" ]; then
        log_error "No namespaces returned by cluster"
        return 1
    fi

    # Partial-match resolution.
    if [ -n "$candidate" ]; then
        local lowered_candidate
        lowered_candidate=$(printf '%s' "$candidate" | tr '[:upper:]' '[:lower:]')
        local matches
        matches=$(printf '%s\n' "$all_ns" | while read -r ns; do
            local lowered_ns
            lowered_ns=$(printf '%s' "$ns" | tr '[:upper:]' '[:lower:]')
            case "$lowered_ns" in
                *"$lowered_candidate"*) printf '%s\n' "$ns" ;;
            esac
        done)

        local match_count
        match_count=$(printf '%s' "$matches" | grep -c . || true)

        if [ "$match_count" -eq 1 ]; then
            local resolved
            resolved=$(printf '%s' "$matches" | head -1)
            log_info "Namespace '$candidate' resolved to '$resolved'"
            echo "$resolved"
            return 0
        elif [ "$match_count" -gt 1 ]; then
            if _kube_interactive; then
                local picked
                picked=$(printf '%s' "$matches" | fzf_select_single "Ambiguous namespace (matched $match_count, pick one): ")
                if [ -n "$picked" ]; then
                    echo "$picked"
                    return 0
                fi
                log_error "No namespace selected"
                return 1
            fi
            log_error "Namespace '$candidate' is ambiguous — matches: $(printf '%s' "$matches" | tr '\n' ' ')"
            return 1
        fi

        # No match at all: list closest candidates for the human.
        log_error "No namespace matches '$candidate' — available: $(printf '%s' "$all_ns" | tr '\n' ' ')"
        return 1
    fi

    # Nothing given: interactive picker on a TTY.
    if _kube_interactive; then
        local picked
        picked=$(printf '%s\n' "$all_ns" | fzf_select_single "Select namespace: ")
        if [ -n "$picked" ]; then
            echo "$picked"
            return 0
        fi
        log_error "No namespace selected"
        return 1
    fi

    # Non-interactive fallback: kubectl current-context default + hint.
    local default_ns
    default_ns=$(kubectl config view --minify --output 'jsonpath={..namespace}' 2>/dev/null)
    default_ns="${default_ns:-default}"
    log_info "No namespace given — using '$default_ns' (tip: pass -n <ns>, set NAMESPACE=, or run interactively to pick from a list)"
    echo "$default_ns"
    return 0
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

# ============================================================================
# Generic resource listing (single implementation for all kinds)
# ============================================================================

# _list_k8s_resources KIND [--namespace NS] [--filter PATTERN]
#   Lists resource names of KIND (pods, deployments, statefulsets, ...).
#   The --filter pattern is passed to jq as a variable (never interpolated
#   into the jq program), so regex metacharacters in user input are safe.
#   An empty --filter (or none) lists everything.
_list_k8s_resources() {
    local kind="$1"
    shift
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

    local ns_option=()
    [ -n "$ns" ] && ns_option=(-n "$ns")

    if [ -n "$pattern" ]; then
        kubectl get "$kind" "${ns_option[@]}" -o json \
            | jq -r --arg pat "$pattern" '.items[].metadata.name | select(test($pat))'
    else
        kubectl get "$kind" "${ns_option[@]}" -o json \
            | jq -r '.items[].metadata.name'
    fi
}

# Public list functions — kept for API compatibility with existing callers.
# Usage: list_pods [--namespace NS] [--filter PATTERN]
list_pods() {
    _list_k8s_resources pods "$@"
}

# Usage: list_deployments [--namespace NS] [--filter PATTERN]
list_deployments() {
    _list_k8s_resources deployments "$@"
}

# Usage: list_statefulsets [--namespace NS] [--filter PATTERN]
list_statefulsets() {
    _list_k8s_resources statefulsets "$@"
}

# ============================================================================
# Single-match resolution for destructive tools
# ============================================================================

# resolve_single_match LIST_FUNCTION_NAME --filter PATTERN [--namespace NS]
#   Resolves a user-supplied name fragment to exactly one resource name.
#   Prints the single match on success.
#   Returns:
#     0 - exactly one match; name on stdout
#     2 - no matches (message on stderr)
#     3 - multiple matches (all candidates on stderr)
#   Non-interactive safe: never prompts. Destructive callers add their own
#   confirmation step after a 0 return.
resolve_single_match() {
    local list_fn="$1"
    shift

    local pattern="" ns="${NAMESPACE:-}"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --filter|-f)  pattern="$2"; shift 2 ;;
            --namespace|-n) ns="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    local matches
    matches=$("$list_fn" --namespace "$ns" --filter "$pattern") || {
        log_error "Failed to list $list_fn resources"
        return 2
    }

    if [ -z "$matches" ]; then
        log_error "No matching resources found for pattern: $pattern"
        return 2
    fi

    local count
    count=$(printf '%s\n' "$matches" | wc -l)
    if [ "$count" -gt 1 ]; then
        log_error "Pattern '$pattern' matches $count resources — be more specific:"
        printf '%s\n' "$matches" >&2
        return 3
    fi

    printf '%s\n' "$matches"
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

    local ns_flag=""
    [ -n "$ns" ] && ns_flag="-n $ns"

    # shellcheck disable=SC2086  # ns_flag should not be quoted (can be empty)
    kubectl get pod "$pod" $ns_flag &>/dev/null
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

    local ns_flag=""
    [ -n "$ns" ] && ns_flag="-n $ns"

    # shellcheck disable=SC2086  # ns_option should not be quoted (can be empty)
    kubectl get deployment "$deployment" $ns_flag &>/dev/null
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

    local ns_flag=""
    [ -n "$ns" ] && ns_flag="-n $ns"

    # shellcheck disable=SC2086  # ns_option should not be quoted (can be empty)
    kubectl get pod "$pod" $ns_flag -o json
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

    local ns_flag=""
    [ -n "$ns" ] && ns_flag="-n $ns"

    # shellcheck disable=SC2086  # ns_option should not be quoted (can be empty)
    kubectl get deployment "$deployment" $ns_flag -o json
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

# ============================================================================
# Destructive-action confirmation
# ============================================================================

# confirm_or_fail ACTION_DESCRIPTION
#   Confirms a destructive action on the terminal, or fails fast when
#   non-interactive unless the caller opted out via YES=1 / FORCE_YES=1.
#   Shared by kube-pod-delete / kube-pod-scale / kube-pod-restart.
confirm_or_fail() {
    local action="$1"
    if [ "${YES:-0}" = "1" ] || [ "${FORCE_YES:-0}" = "1" ]; then
        return 0
    fi
    if [ -t 0 ]; then
        printf "%s? [y/N] " "$action"
        local answer=""
        read -r answer < /dev/tty || true
        [[ "${answer:-}" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
    else
        echo "Refusing to proceed without confirmation (set YES=1 to skip the prompt): $action" >&2
        exit 2
    fi
}
