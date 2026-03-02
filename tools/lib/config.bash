#!/bin/bash
# config.bash - Centralized configuration management for the dev environment
# Provides consistent configuration loading, validation, and documentation

# Guard against multiple sourcing
if [ -n "${_CONFIG_LOADED:-}" ]; then return 0; fi
_CONFIG_LOADED=1

# Version of the configuration system
readonly CONFIG_VERSION="1.0.0"

# Source error handling if available
if [ -f "${BASH_SOURCE[0]%/*}/error-handling.bash" ]; then
    # shellcheck source=lib/error-handling.bash
    source "${BASH_SOURCE[0]%/*}/error-handling.bash"
fi

# Configuration file paths (checked in order)
readonly CONFIG_SEARCH_PATHS=(
    "${DEVENV_CONFIG_FILE:-}"
    "$HOME/.devenv/config"
    "$HOME/.config/devenv/config"
    "/etc/devenv/config"
)

# Global configuration storage (associative array if bash 4+)
if [ "${BASH_VERSINFO[0]}" -ge 4 ]; then
    declare -gA DEVENV_CONFIG=()
fi

# Get a configuration value with fallback to default
# Args:
#   $1 - Configuration key
#   $2 - Default value (optional)
# Returns: Configuration value or default
config_get() {
    local key="$1"
    local default="${2:-}"
    
    # Try associative array first (bash 4+)
    if [ "${BASH_VERSINFO[0]}" -ge 4 ] && [ -n "${DEVENV_CONFIG[$key]:-}" ]; then
        echo "${DEVENV_CONFIG[$key]}"
        return 0
    fi
    
    # Try environment variable
    local env_value="${!key:-}"
    if [ -n "$env_value" ]; then
        echo "$env_value"
        return 0
    fi
    
    # Return default
    echo "$default"
}

# Set a configuration value
# Args:
#   $1 - Configuration key
#   $2 - Configuration value
config_set() {
    local key="$1"
    local value="$2"
    
    if [ "${BASH_VERSINFO[0]}" -ge 4 ]; then
        DEVENV_CONFIG[$key]="$value"
    fi
    
    # Also export as environment variable
    export "$key=$value"
}

# Check if a configuration key exists
# Args:
#   $1 - Configuration key
# Returns: 0 if exists, 1 otherwise
config_has() {
    local key="$1"
    
    # Check associative array
    if [ "${BASH_VERSINFO[0]}" -ge 4 ] && [ -n "${DEVENV_CONFIG[$key]:-}" ]; then
        return 0
    fi
    
    # Check environment
    [ -n "${!key:-}" ]
}

# Load configuration from a file
# Args:
#   $1 - Config file path (optional, searches default locations if not provided)
# Format: KEY=value lines, supports comments with #
config_load() {
    local config_file="${1:-}"
    
    # If no file specified, search default locations
    if [ -z "$config_file" ]; then
        for path in "${CONFIG_SEARCH_PATHS[@]}"; do
            if [ -n "$path" ] && [ -f "$path" ]; then
                config_file="$path"
                break
            fi
        done
    fi
    
    # If still no file, return success (no config file is ok)
    if [ -z "$config_file" ] || [ ! -f "$config_file" ]; then
        return 0
    fi
    
    # Read and process config file
    while IFS='=' read -r key value; do
        # Skip empty lines and comments
        [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
        
        # Trim whitespace
        key=$(echo "$key" | xargs)
        value=$(echo "$value" | xargs)
        
        # Remove quotes if present
        value="${value%\"}"
        value="${value#\"}"
        value="${value%\'}"
        value="${value#\'}"
        
        # Set configuration
        config_set "$key" "$value"
    done < "$config_file"
}

# Require a configuration value (exit if not set)
# Args:
#   $1 - Configuration key
#   $2 - Optional custom error message
config_require() {
    local key="$1"
    local message="${2:-Required configuration '$key' is not set}"
    
    if ! config_has "$key"; then
        if command -v die >/dev/null 2>&1; then
            die "$message" 3
        else
            echo "FATAL: $message" >&2
            exit 3
        fi
    fi
}

# Validate a configuration value matches a pattern
# Args:
#   $1 - Configuration key
#   $2 - Regex pattern
#   $3 - Optional custom error message
config_validate_pattern() {
    local key="$1"
    local pattern="$2"
    local message="${3:-Configuration '$key' does not match required pattern: $pattern}"
    
    local value
    value=$(config_get "$key")
    
    if [ -z "$value" ]; then
        if command -v die >/dev/null 2>&1; then
            die "Configuration '$key' is not set" 3
        else
            echo "FATAL: Configuration '$key' is not set" >&2
            exit 3
        fi
    fi
    
    if ! [[ "$value" =~ $pattern ]]; then
        if command -v die >/dev/null 2>&1; then
            die "$message (got: $value)" 3
        else
            echo "FATAL: $message (got: $value)" >&2
            exit 3
        fi
    fi
}

# Validate a configuration value is a positive integer
# Args:
#   $1 - Configuration key
#   $2 - Optional custom error message
config_validate_integer() {
    local key="$1"
    local message="${2:-Configuration '$key' must be a positive integer}"
    
    config_validate_pattern "$key" "^[0-9]+$" "$message"
    
    local value
    value=$(config_get "$key")
    
    if [ "$value" -le 0 ]; then
        if command -v die >/dev/null 2>&1; then
            die "$message (got: $value)" 3
        else
            echo "FATAL: $message (got: $value)" >&2
            exit 3
        fi
    fi
}

# Validate a configuration value is one of allowed values
# Args:
#   $1 - Configuration key
#   $2+ - Allowed values
config_validate_enum() {
    local key="$1"
    shift
    local allowed_values=("$@")
    
    local value
    value=$(config_get "$key")
    
    if [ -z "$value" ]; then
        if command -v die >/dev/null 2>&1; then
            die "Configuration '$key' is not set" 3
        else
            echo "FATAL: Configuration '$key' is not set" >&2
            exit 3
        fi
    fi
    
    local found=0
    for allowed in "${allowed_values[@]}"; do
        if [ "$value" = "$allowed" ]; then
            found=1
            break
        fi
    done
    
    if [ "$found" -eq 0 ]; then
        if command -v die >/dev/null 2>&1; then
            die "Configuration '$key' must be one of: ${allowed_values[*]} (got: $value)" 3
        else
            echo "FATAL: Configuration '$key' must be one of: ${allowed_values[*]} (got: $value)" >&2
            exit 3
        fi
    fi
}

# Get script directory (common pattern in these scripts)
# Returns: Absolute path to directory containing the calling script
config_get_script_dir() {
    local calling_script="${BASH_SOURCE[1]}"
    if [ -z "$calling_script" ]; then
        calling_script="$0"
    fi
    
    local script_path
    script_path=$(readlink -f "$calling_script")
    dirname "$script_path"
}

# Get dev environment root directory
# Returns: Absolute path to dev environment root
config_get_devenv_root() {
    if [ -n "${DEVENV_ROOT:-}" ]; then
        echo "$DEVENV_ROOT"
        return 0
    fi
    
    # Try to detect from script location
    local script_dir
    script_dir=$(config_get_script_dir)
    
    # Check if we're in a known dev environment directory structure
    if [ -f "$script_dir/../.devcontainer/devcontainer.json" ]; then
        dirname "$script_dir"
    elif [ -f "$script_dir/../../.devcontainer/devcontainer.json" ]; then
        dirname "$(dirname "$script_dir")"
    else
        # Fallback to current directory
        pwd
    fi
}

# Initialize default dev environment configuration
# Sets common configuration values if not already set
config_init_defaults() {
    # Root directory
    if ! config_has "DEVENV_ROOT"; then
        config_set "DEVENV_ROOT" "$(config_get_devenv_root)"
    fi
    
    # Update check interval (2 hours default)
    if ! config_has "DEVENV_UPDATE_INTERVAL"; then
        config_set "DEVENV_UPDATE_INTERVAL" "$((2 * 3600))"
    fi
    
    # Update check max iterations (0 = unlimited)
    if ! config_has "DEVENV_UPDATE_MAX_ITERATIONS"; then
        config_set "DEVENV_UPDATE_MAX_ITERATIONS" "0"
    fi
    
    # Log level for error handling
    if ! config_has "ERROR_HANDLING_LOG_LEVEL"; then
        config_set "ERROR_HANDLING_LOG_LEVEL" "1"  # INFO
    fi
    
    # Git configuration
    if ! config_has "GIT_USER_NAME"; then
        config_set "GIT_USER_NAME" ""
    fi
    
    if ! config_has "GIT_USER_EMAIL"; then
        config_set "GIT_USER_EMAIL" ""
    fi
    
    # Container configuration
    if ! config_has "CONTAINER_WORKSPACE_FOLDER"; then
        config_set "CONTAINER_WORKSPACE_FOLDER" "/workspaces/devenv"
    fi
}

# Print all configuration values (for debugging)
config_dump() {
    echo "=== Dev Environment Configuration ===" >&2
    echo "Version: $CONFIG_VERSION" >&2
    echo "" >&2
    
    if [ "${BASH_VERSINFO[0]}" -ge 4 ]; then
        for key in "${!DEVENV_CONFIG[@]}"; do
            echo "$key=${DEVENV_CONFIG[$key]}" >&2
        done
    else
        echo "Warning: Bash 4+ required for config dump" >&2
    fi
    
    echo "===========================" >&2
}

# Export configuration as environment variables
# Useful for passing config to child processes
config_export() {
    if [ "${BASH_VERSINFO[0]}" -ge 4 ]; then
        for key in "${!DEVENV_CONFIG[@]}"; do
            export "$key=${DEVENV_CONFIG[$key]}"
        done
    fi
}

# Save configuration to a file
# Args:
#   $1 - Output file path
config_save() {
    local output_file="$1"
    
    if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
        if command -v die >/dev/null 2>&1; then
            die "Bash 4+ required for config_save" 1
        else
            echo "FATAL: Bash 4+ required for config_save" >&2
            exit 1
        fi
    fi
    
    # Create directory if needed
    local output_dir
    output_dir=$(dirname "$output_file")
    mkdir -p "$output_dir" || {
        if command -v die >/dev/null 2>&1; then
            die "Failed to create config directory: $output_dir" 1
        else
            echo "FATAL: Failed to create config directory: $output_dir" >&2
            exit 1
        fi
    }
    
    # Write header
    {
        echo "# Dev Environment Configuration"
        echo "# Generated: $(date)"
        echo "# Version: $CONFIG_VERSION"
        echo ""
    } > "$output_file"
    
    # Write config values
    for key in "${!DEVENV_CONFIG[@]}"; do
        echo "$key=${DEVENV_CONFIG[$key]}" >> "$output_file"
    done
}
