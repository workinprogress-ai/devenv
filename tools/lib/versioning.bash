#!/bin/bash
# lib/versioning.bash - Script version management and compatibility checking
# Version: 1.0.0

# Guard against multiple sourcing
if [ -n "${_VERSIONING_LOADED:-}" ]; then return 0; fi
_VERSIONING_LOADED=1

# Version comparison utilities for devenv scripts

# Script version format: MAJOR.MINOR.PATCH
# MAJOR: Incompatible changes (e.g., removed features, changed behavior)
# MINOR: New features, backward compatible
# PATCH: Bug fixes, backward compatible

# Minimum required versions for environment components
readonly MIN_BASH_VERSION="4.0"
readonly MIN_GIT_VERSION="2.0"

# Parse version string into major, minor, patch components
# Usage: parse_version "1.2.3" -> returns array (1 2 3)
parse_version() {
    local version="$1"
    echo "$version" | tr '.' ' '
}

# Compare two version strings (numeric MAJOR.MINOR.PATCH core; pre-release and
# build suffixes such as -rc.1 or +build5 are ignored)
# Returns: 0 if equal, 1 if v1 > v2, 2 if v1 < v2
# Usage: compare_versions "1.2.3" "1.2.0"
compare_versions() {
    local v1="$1"
    local v2="$2"
    
    # shellcheck disable=SC2046,SC2086  # Word splitting intentional for read
    read -r v1_major v1_minor v1_patch <<< $(parse_version "$v1")
    # shellcheck disable=SC2046,SC2086  # Word splitting intentional for read
    read -r v2_major v2_minor v2_patch <<< $(parse_version "$v2")
    
    # Keep only each part's leading digits: a pre-release or build suffix
    # ("3-rc", "0+build5") is ignored, so versions compare by their numeric
    # MAJOR.MINOR.PATCH core. (read leaves any remainder in the last variable,
    # e.g. "1.2.3-rc.1" gives patch="3-rc 1".)
    v1_major=${v1_major%%[!0-9]*}
    v1_minor=${v1_minor%%[!0-9]*}
    v1_patch=${v1_patch%%[!0-9]*}
    v2_major=${v2_major%%[!0-9]*}
    v2_minor=${v2_minor%%[!0-9]*}
    v2_patch=${v2_patch%%[!0-9]*}

    # Default missing parts to 0
    v1_major=${v1_major:-0}
    v1_minor=${v1_minor:-0}
    v1_patch=${v1_patch:-0}
    v2_major=${v2_major:-0}
    v2_minor=${v2_minor:-0}
    v2_patch=${v2_patch:-0}
    
    # Compare major
    if [ "$v1_major" -gt "$v2_major" ]; then
        return 1
    elif [ "$v1_major" -lt "$v2_major" ]; then
        return 2
    fi
    
    # Compare minor
    if [ "$v1_minor" -gt "$v2_minor" ]; then
        return 1
    elif [ "$v1_minor" -lt "$v2_minor" ]; then
        return 2
    fi
    
    # Compare patch
    if [ "$v1_patch" -gt "$v2_patch" ]; then
        return 1
    elif [ "$v1_patch" -lt "$v2_patch" ]; then
        return 2
    fi
    
    # Equal
    return 0
}

# Check if version1 >= version2
# Usage: version_gte "2.0.0" "1.5.0"
version_gte() {
    compare_versions "$1" "$2"
    local result=$?
    [ "$result" -eq 0 ] || [ "$result" -eq 1 ]
}

# Get bash version
get_bash_version() {
    echo "${BASH_VERSION%%[^0-9.]*}"
}

# Get git version
get_git_version() {
    git --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' | head -n 1
}

# Check bash version compatibility
# Usage: check_bash_version "4.0"
# shellcheck disable=SC2120  # Function supports optional argument
check_bash_version() {
    local required_version="${1:-$MIN_BASH_VERSION}"
    local current_version
    current_version=$(get_bash_version)
    
    if ! version_gte "$current_version" "$required_version"; then
        echo "ERROR: Bash version $required_version or higher required. Current: $current_version" >&2
        return 1
    fi
    return 0
}

# Check git version compatibility
# Usage: check_git_version "2.0"
# shellcheck disable=SC2120  # Function supports optional argument
check_git_version() {
    local required_version="${1:-$MIN_GIT_VERSION}"
    local current_version
    current_version=$(get_git_version)
    
    if [ -z "$current_version" ]; then
        echo "ERROR: Git is not installed" >&2
        return 1
    fi
    
    if ! version_gte "$current_version" "$required_version"; then
        echo "ERROR: Git version $required_version or higher required. Current: $current_version" >&2
        return 1
    fi
    return 0
}

# Check all minimum requirements
# Usage: check_environment_requirements
check_environment_requirements() {
    local failed=0
    
    if ! check_bash_version; then
        failed=1
    fi
    
    if ! check_git_version; then
        failed=1
    fi
    
    return "$failed"
}

# Check if script version is compatible with minimum required version
# Usage: require_script_version "1.5.0" "2.0.0" "my-script.sh"
require_script_version() {
    local current_version="$1"
    local required_version="$2"
    local script_name="${3:-script}"
    
    if ! version_gte "$current_version" "$required_version"; then
        echo "ERROR: $script_name version $required_version or higher required. Current: $current_version" >&2
        return 1
    fi
    return 0
}
