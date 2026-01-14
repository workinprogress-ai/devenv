#!/bin/bash
# artifact-operations.bash - GitHub Packages operations library
# Version: 1.0.0
# Description: Functions for querying and filtering artifacts from GitHub Packages
# Requirements: Bash 4.0+, gh CLI, jq
# Author: WorkInProgress.ai
# Last Modified: 2026-01-14

# Guard against multiple sourcing
if [ -n "${_ARTIFACT_OPERATIONS_LOADED:-}" ]; then
    return 0
fi
readonly _ARTIFACT_OPERATIONS_LOADED=1

# Ensure dependencies are loaded
source "${DEVENV_TOOLS}/lib/error-handling.bash"
source "${DEVENV_TOOLS}/lib/github-helpers.bash"

# ============================================================================
# Package Type Definitions
# ============================================================================

# Get normalized package type identifier
# Usage: get_package_type_id "npm" or "nuget" or "docker" etc.
# Arguments:
#   $1 - Package type name (npm, nuget, docker, maven, rubygems, etc.)
# Returns: Normalized type ID for filtering/matching
# Example:
#   type_id=$(get_package_type_id "npm")
get_package_type_id() {
    local type="${1,,}"  # Convert to lowercase
    
    case "$type" in
        npm|node|javascript)
            echo "npm"
            ;;
        nuget|cs|csharp|dotnet|.net)
            echo "nuget"
            ;;
        docker|container|oci)
            echo "docker"
            ;;
        maven|java)
            echo "maven"
            ;;
        rubygems|ruby|gems)
            echo "rubygems"
            ;;
        gradle)
            echo "gradle"
            ;;
        rust|cargo)
            echo "cargo"
            ;;
        *)
            echo "$type"
            ;;
    esac
}

# Get all supported package types
# Usage: get_supported_package_types
# Returns: Space-separated list of supported package types
get_supported_package_types() {
    echo "npm nuget docker maven rubygems gradle cargo"
}

# Validate package type is supported
# Usage: is_supported_package_type "npm"
# Arguments:
#   $1 - Package type to validate
# Returns: 0 if supported, 1 if not
is_supported_package_type() {
    local type
    type=$(get_package_type_id "$1")
    
    local supported_types
    supported_types=$(get_supported_package_types)
    
    [[ " $supported_types " =~ \ $type\  ]]
}

# ============================================================================
# GitHub Packages API Operations
# ============================================================================

# Query GitHub Packages using the GitHub REST API
# Usage: query_packages [--owner OWNER] [--type TYPE] [--name NAME] [--repo REPO]
# Arguments:
#   --owner OWNER         Repository owner (optional, uses GH_ORG env var if not provided)
#   --type TYPE           Filter by package type (npm, nuget, docker, etc.)
#   --name NAME           Filter by package name (partial match)
#   --repo REPO           Specific repository path or owner/repo to query
# Returns: JSON array of package objects with fields:
#   - id, name, package_type, created_at, updated_at, url, html_url, owner
# Example:
#   query_packages --owner workinprogress-ai --type npm
query_packages() {
    local owner=""
    local type=""
    local name=""
    local repo=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --owner)
                owner="$2"
                shift 2
                ;;
            --type)
                type="$(get_package_type_id "$2")"
                shift 2
                ;;
            --name)
                name="$2"
                shift 2
                ;;
            --repo)
                repo="$2"
                shift 2
                ;;
            *)
                log_error "Unknown option: $1"
                return 1
                ;;
        esac
    done

    # Use GH_ORG environment variable if owner not provided
    if [ -z "$owner" ]; then
        owner="${GH_ORG:-}"
    fi

    # Validate required arguments
    if [ -z "$owner" ]; then
        log_error "owner is required (set --owner or GH_ORG environment variable)"
        return 1
    fi

    # If repo is a directory path, resolve it to owner/repo format
    if [ -n "$repo" ] && [ -d "$repo" ]; then
        repo=$(get_full_repo_name "$repo") || return 1
    fi

    # Build API endpoint
    local endpoint="/users/${owner}/packages"
    if [ -n "$repo" ]; then
        endpoint="/repos/${owner}/${repo}/packages"
    fi

    # Build query parameters - use --method GET to send as query string
    local query_params="--method GET"
    if [ -n "$type" ]; then
        query_params="$query_params -f package_type=$type"
    fi

    # Query packages from GitHub API - capture both exit code and output
    local query_result
    local gh_exit_code=0
    # shellcheck disable=SC2086
    query_result=$(gh api "$endpoint" $query_params --paginate 2>&1) || gh_exit_code=$?
    
    # Distinguish between actual errors and empty results
    if [ $gh_exit_code -ne 0 ]; then
        # Check if it's an auth/permission error vs just empty results
        if echo "$query_result" | grep -qE "HTTP|error|Error"; then
            log_error "GitHub API error: $query_result"
            return 1
        fi
        # Empty results are acceptable, treat as empty array
        query_result="[]"
    fi
    
    # Extract items from response and convert to stream format
    query_result=$(echo "$query_result" | jq -c '.[]?' 2>/dev/null || echo "[]")

    # Filter by name if specified
    if [ -n "$name" ]; then
        # Use case-insensitive partial match
        query_result=$(echo "$query_result" | jq -s "map(select(.name | ascii_downcase | contains(\"${name,,}\")))" 2>/dev/null) || {
            log_error "Failed to filter packages by name: $name"
            return 1
        }
        # Convert back to stream format for collection
        query_result=$(echo "$query_result" | jq -c '.[]?' 2>/dev/null)
    fi

    # Collect all items into a single JSON array
    query_result=$(echo "$query_result" | jq -s '.' 2>/dev/null || echo "[]")

    echo "$query_result"
}

# Get versions for a specific package
# Usage: get_package_versions [--owner OWNER] --type TYPE --name NAME [--repo REPO]
# Arguments:
#   --owner OWNER         Repository owner (optional, uses GH_ORG env var if not provided)
#   --type TYPE           Package type (npm, nuget, docker, etc.) (required)
#   --name NAME           Package name (required)
#   --repo REPO           Specific repository to query
# Returns: JSON array of version objects with fields:
#   - id, name, version, created_at, updated_at, html_url
# Example:
#   get_package_versions --owner workinprogress-ai --type npm --name my-package
get_package_versions() {
    local owner=""
    local type=""
    local name=""
    local repo=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --owner)
                owner="$2"
                shift 2
                ;;
            --type)
                type="$(get_package_type_id "$2")"
                shift 2
                ;;
            --name)
                name="$2"
                shift 2
                ;;
            --repo)
                repo="$2"
                shift 2
                ;;
            *)
                log_error "Unknown option: $1"
                return 1
                ;;
        esac
    done

    # Use GH_ORG environment variable if owner not provided
    if [ -z "$owner" ]; then
        owner="${GH_ORG:-}"
    fi

    # Validate required arguments
    if [ -z "$owner" ] || [ -z "$type" ] || [ -z "$name" ]; then
        log_error "owner (set --owner or GH_ORG), type, and name are all required"
        return 1
    fi

    # If repo is a directory path, resolve it to owner/repo format
    if [ -n "$repo" ] && [ -d "$repo" ]; then
        repo=$(resolve_repo_from_path "$repo") || return 1
    fi

    # Build API endpoint
    local endpoint="/users/${owner}/packages/${type}/${name}/versions"
    if [ -n "$repo" ]; then
        endpoint="/repos/${owner}/${repo}/packages/${type}/${name}/versions"
    fi

    # Query package versions from GitHub API - capture both exit code and output
    local versions_result
    local gh_exit_code=0
    versions_result=$(gh api "$endpoint" --paginate 2>&1) || gh_exit_code=$?
    
    # Distinguish between actual errors and empty results
    if [ $gh_exit_code -ne 0 ]; then
        # Check if it's an auth/permission error vs just empty results
        if echo "$versions_result" | grep -qE "HTTP|error|Error"; then
            log_error "GitHub API error: $versions_result"
            return 1
        fi
        # Empty results are acceptable, treat as empty array
        versions_result="[]"
    fi
    
    # Convert response to JSON array format
    versions_result=$(echo "$versions_result" | jq -s '.' 2>/dev/null || echo "[]")
    
    echo "$versions_result"
}

# ============================================================================
# Export Functions
# ============================================================================

export -f get_package_type_id
export -f get_supported_package_types
export -f is_supported_package_type
export -f query_packages
export -f get_package_versions
