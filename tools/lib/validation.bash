#!/bin/bash
# validation.bash - Input validation and format checking library
# Version: 1.0.0
# Description: Centralized validation functions for common input formats
# Requirements: Bash 4.0+
# Author: WorkInProgress.ai
# Last Modified: 2026-01-04

# Guard against multiple sourcing
if [ -n "${_VALIDATION_LOADED:-}" ]; then
    return 0
fi
_VALIDATION_LOADED=1

# Ensure error handling library is loaded
if [ -z "${_ERROR_HANDLING_LOADED:-}" ] && [ -f "${DEVENV_ROOT:-}/tools/lib/error-handling.bash" ]; then
    source "${DEVENV_ROOT:-}/tools/lib/error-handling.bash"
fi

# ============================================================================
# String Validation
# ============================================================================

# Validate non-empty string
# Usage: validate_not_empty STRING [CONTEXT]
# Arguments:
#   STRING                String to validate
#   CONTEXT               Optional context for error message
# Returns: 0 if valid, 1 if empty
# Example:
#   validate_not_empty "$name" "name" || return 1
validate_not_empty() {
    local str="$1"
    local context="${2:-value}"
    
    if [ -z "$str" ]; then
        log_error "$context cannot be empty"
        return 1
    fi
}

# Validate string length
# Usage: validate_string_length STRING MIN [MAX] [CONTEXT]
# Arguments:
#   STRING                String to validate
#   MIN                   Minimum length
#   MAX                   Maximum length (optional)
#   CONTEXT               Optional context for error message
# Returns: 0 if valid, 1 if invalid length
# Example:
#   validate_string_length "$name" 1 50 "name" || return 1
validate_string_length() {
    local str="$1"
    local min="$2"
    local max="${3:-}"
    local context="${4:-string}"
    local len=${#str}
    
    if [ "$len" -lt "$min" ]; then
        log_error "$context must be at least $min characters (got $len)"
        return 1
    fi
    
    if [ -n "$max" ] && [ "$len" -gt "$max" ]; then
        log_error "$context must not exceed $max characters (got $len)"
        return 1
    fi
}

# Validate alphanumeric string
# Usage: validate_alphanumeric STRING [CONTEXT]
# Arguments:
#   STRING                String to validate
#   CONTEXT               Optional context for error message
# Returns: 0 if valid, 1 if contains non-alphanumeric chars
# Example:
#   validate_alphanumeric "$username" "username" || return 1
validate_alphanumeric() {
    local str="$1"
    local context="${2:-string}"
    
    if [[ ! "$str" =~ ^[a-zA-Z0-9]+$ ]]; then
        log_error "$context must contain only letters and numbers"
        return 1
    fi
}

# Validate alphanumeric with hyphens and underscores
# Usage: validate_slug STRING [CONTEXT]
# Arguments:
#   STRING                String to validate
#   CONTEXT               Optional context for error message
# Returns: 0 if valid, 1 if invalid format
# Example:
#   validate_slug "$repo-name" "repository name" || return 1
validate_slug() {
    local str="$1"
    local context="${2:-string}"
    
    if [[ ! "$str" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        log_error "$context must contain only letters, numbers, hyphens, and underscores"
        return 1
    fi
}

# ============================================================================
# Email Validation
# ============================================================================

# Validate email address format
# Usage: validate_email EMAIL
# Arguments:
#   EMAIL                 Email address to validate
# Returns: 0 if valid format, 1 if invalid
# Example:
#   validate_email "user@example.com" || return 1
validate_email() {
    local email="$1"
    
    if [ -z "$email" ]; then
        log_error "Email address cannot be empty"
        return 1
    fi
    
    # Basic email validation (allows most valid email formats)
    if [[ ! "$email" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
        log_error "Invalid email format: $email"
        return 1
    fi
}

# ============================================================================
# URL Validation
# ============================================================================

# Validate HTTP/HTTPS URL format
# Usage: validate_url URL
# Arguments:
#   URL                   URL to validate
# Returns: 0 if valid format, 1 if invalid
# Example:
#   validate_url "https://example.com" || return 1
validate_url() {
    local url="$1"
    
    if [ -z "$url" ]; then
        log_error "URL cannot be empty"
        return 1
    fi
    
    # Basic URL validation
    if [[ ! "$url" =~ ^https?:// ]]; then
        log_error "URL must start with http:// or https://"
        return 1
    fi
}

# ============================================================================
# Numeric Validation
# ============================================================================

# Validate integer
# Usage: validate_integer VALUE [MIN] [MAX]
# Arguments:
#   VALUE                 Value to validate
#   MIN                   Minimum value (optional)
#   MAX                   Maximum value (optional)
# Returns: 0 if valid, 1 if invalid
# Example:
#   validate_integer "$count" 0 100 || return 1
validate_integer() {
    local value="$1"
    local min="${2:-}"
    local max="${3:-}"
    
    if [ -z "$value" ]; then
        log_error "Integer value cannot be empty"
        return 1
    fi
    
    if ! [[ "$value" =~ ^-?[0-9]+$ ]]; then
        log_error "$value is not a valid integer"
        return 1
    fi
    
    if [ -n "$min" ] && [ "$value" -lt "$min" ]; then
        log_error "Value must be at least $min (got $value)"
        return 1
    fi
    
    if [ -n "$max" ] && [ "$value" -gt "$max" ]; then
        log_error "Value must not exceed $max (got $value)"
        return 1
    fi
}

# Validate positive integer
# Usage: validate_positive_integer VALUE
# Arguments:
#   VALUE                 Value to validate
# Returns: 0 if valid, 1 if invalid
# Example:
#   validate_positive_integer "$port" || return 1
validate_positive_integer() {
    local value="$1"
    
    if [ -z "$value" ]; then
        log_error "Positive integer value cannot be empty"
        return 1
    fi
    
    if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -eq 0 ]; then
        log_error "$value is not a valid positive integer"
        return 1
    fi
}

# ============================================================================
# File and Directory Validation
# ============================================================================

# Validate file exists
# Usage: validate_file_exists FILE
# Arguments:
#   FILE                  File path to validate
# Returns: 0 if exists, 1 if not
# Example:
#   validate_file_exists "/path/to/file" || return 1
validate_file_exists() {
    local file="$1"
    
    if [ -z "$file" ]; then
        log_error "File path cannot be empty"
        return 1
    fi
    
    if [ ! -f "$file" ]; then
        log_error "File not found: $file"
        return 1
    fi
}

# Validate directory exists
# Usage: validate_directory_exists DIR
# Arguments:
#   DIR                   Directory path to validate
# Returns: 0 if exists, 1 if not
# Example:
#   validate_directory_exists "/path/to/dir" || return 1
validate_directory_exists() {
    local dir="$1"
    
    if [ -z "$dir" ]; then
        log_error "Directory path cannot be empty"
        return 1
    fi
    
    if [ ! -d "$dir" ]; then
        log_error "Directory not found: $dir"
        return 1
    fi
}

# Validate directory is readable
# Usage: validate_directory_readable DIR
# Arguments:
#   DIR                   Directory path to validate
# Returns: 0 if readable, 1 if not
# Example:
#   validate_directory_readable "/path/to/dir" || return 1
validate_directory_readable() {
    local dir="$1"
    
    validate_directory_exists "$dir" || return 1
    
    if [ ! -r "$dir" ]; then
        log_error "Directory is not readable: $dir"
        return 1
    fi
}

# Validate directory is writable
# Usage: validate_directory_writable DIR
# Arguments:
#   DIR                   Directory path to validate
# Returns: 0 if writable, 1 if not
# Example:
#   validate_directory_writable "/path/to/dir" || return 1
validate_directory_writable() {
    local dir="$1"
    
    validate_directory_exists "$dir" || return 1
    
    if [ ! -w "$dir" ]; then
        log_error "Directory is not writable: $dir"
        return 1
    fi
}

# ============================================================================
# Option/Choice Validation
# ============================================================================

# Validate choice from list
# Usage: validate_choice VALUE OPTION1 OPTION2 ...
# Arguments:
#   VALUE                 Value to validate
#   OPTION1, OPTION2...   List of valid options
# Returns: 0 if value is in list, 1 if not
# Example:
#   validate_choice "$action" "create" "update" "delete" || return 1
validate_choice() {
    local value="$1"
    shift
    local options=("$@")
    
    if [ -z "$value" ]; then
        log_error "Value cannot be empty"
        return 1
    fi
    
    for option in "${options[@]}"; do
        if [ "$value" = "$option" ]; then
            return 0
        fi
    done
    
    log_error "Invalid choice: $value (must be one of: ${options[*]})"
    return 1
}

# ============================================================================
# Git Validation
# ============================================================================

# Validate git branch name
# Usage: validate_branch_name BRANCH
# Arguments:
#   BRANCH                Branch name to validate
# Returns: 0 if valid, 1 if invalid
# Example:
#   validate_branch_name "feature/new-feature" || return 1
validate_branch_name() {
    local branch="$1"
    
    if [ -z "$branch" ]; then
        log_error "Branch name cannot be empty"
        return 1
    fi
    
    # Invalid: contains spaces, ends with /, starts with @, contains @{
    if [[ "$branch" =~ [[:space:]] ]] || \
       [[ "$branch" =~ /$  ]] || \
       [[ "$branch" =~ ^@ ]] || \
       [[ "$branch" =~ @\{ ]]; then
        log_error "Invalid branch name: $branch"
        return 1
    fi
}

# Validate git commit hash
# Usage: validate_commit_hash HASH
# Arguments:
#   HASH                  Commit hash to validate
# Returns: 0 if valid, 1 if invalid
# Example:
#   validate_commit_hash "abc1234567" || return 1
validate_commit_hash() {
    local hash="$1"
    
    if [ -z "$hash" ]; then
        log_error "Commit hash cannot be empty"
        return 1
    fi
    
    # Allow 7-64 hex characters (short SHA-1 to full SHA-256 hash)
    if ! [[ "$hash" =~ ^[a-f0-9]{7,64}$ ]]; then
        log_error "Invalid commit hash: $hash"
        return 1
    fi
}

# ============================================================================
# Version Validation
# ============================================================================

# Validate semantic version format
# Usage: validate_semver VERSION
# Arguments:
#   VERSION               Version to validate (e.g., 1.2.3, 1.2.3-rc1, 1.2.3+build)
# Returns: 0 if valid, 1 if invalid
# Example:
#   validate_semver "1.2.3" || return 1
validate_semver() {
    local version="$1"
    
    if [ -z "$version" ]; then
        log_error "Version cannot be empty"
        return 1
    fi
    
    # Semantic version: MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
    if ! [[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?(\+[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*)?$ ]]; then
        log_error "Invalid semantic version: $version"
        return 1
    fi
}

# ============================================================================
# Combined Validators
# ============================================================================

# Validate required parameters are not empty
# Usage: validate_required PARAM1 PARAM2 ...
# Arguments:
#   PARAM1, PARAM2...     Parameters to validate (stops on first empty)
# Returns: 0 if all non-empty, 1 if any empty
# Example:
#   validate_required "$name" "$email" "$url" || return 1
validate_required() {
    local param
    for param in "$@"; do
        if [ -z "$param" ]; then
            log_error "Required parameter is empty"
            return 1
        fi
    done
}

# Export functions
export -f validate_not_empty
export -f validate_string_length
export -f validate_alphanumeric
export -f validate_slug
export -f validate_email
export -f validate_url
export -f validate_integer
export -f validate_positive_integer
export -f validate_file_exists
export -f validate_directory_exists
export -f validate_directory_readable
export -f validate_directory_writable
export -f validate_choice
export -f validate_branch_name
export -f validate_commit_hash
export -f validate_semver
export -f validate_required
