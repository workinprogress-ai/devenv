#!/usr/bin/env bash
# config-reader.bash
# Library for reading INI-style configuration files with environment variable expansion
# Provides: config_read_value(), config_read_array(), config_validate_required()

# Guard against multiple sourcing
if [ -n "${_CONFIG_READER_LOADED:-}" ]; then return 0; fi
_CONFIG_READER_LOADED=1

# Initialize config reader
# Usage: config_init <config_file_path>
config_init() {
    local config_file="$1"
    
    if [[ ! -f "$config_file" ]]; then
        echo "ERROR: Configuration file not found: $config_file" >&2
        return 1
    fi
    
    CONFIG_FILE="$config_file"
    return 0
}

# Read a single configuration value
# Usage: config_read_value <section> <key> [default_value]
# Returns: The value with environment variables expanded, or default_value if not found
config_read_value() {
    local section="$1"
    local key="$2"
    local default="${3:-}"
    
    if [[ -z "$CONFIG_FILE" ]]; then
        echo "ERROR: config_init not called" >&2
        return 1
    fi
    
    local value
    value=$(awk -v section="$section" -v key="$key" '
        /^\['"$section"'\]/ { in_section=1; next }
        /^\[/ { in_section=0; next }
        in_section && /^'"$key"'=/ {
            sub(/^'"$key"'=/, "")
            print
            exit
        }
    ' "$CONFIG_FILE")
    
    # If not found and default provided, use default
    if [[ -z "$value" ]]; then
        value="$default"
    fi
    
    # Expand environment variables
    # Supports ${VAR_NAME} syntax
    value=$(echo "$value" | sed 's/\${GH_ORG}/'"${GH_ORG:-}"'/g')
    value=$(echo "$value" | sed 's/\${GH_USER}/'"${GH_USER:-}"'/g')
    value=$(echo "$value" | sed 's/\${GH_TOKEN}/'"${GH_TOKEN:-}"'/g')
    
    echo "$value"
    return 0
}

# Read a configuration value as an array (comma-separated)
# Usage: config_read_array <section> <key>
# Returns: Space-separated values (elements)
# Note: Array elements must be single words or hyphenated (no spaces)
#       Multi-word values will be split on whitespace when used with bash arrays
#       Use hyphens for multi-word items: feature-request instead of feature request
config_read_array() {
    local section="$1"
    local key="$2"
    
    local value
    value=$(config_read_value "$section" "$key" "")
    
    if [[ -z "$value" ]]; then
        return 1
    fi
    
    # Convert comma-separated to space-separated
    # Also trim whitespace from each element
    echo "$value" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | tr '\n' ' ' | sed 's/[[:space:]]*$//'
    return 0
}

# Validate that required configuration keys exist and are non-empty
# Usage: config_validate_required <section> <key1> [key2] [key3] ...
# Returns: 0 if all required keys exist and are non-empty, 1 otherwise
config_validate_required() {
    local section="$1"
    shift  # Remove first argument
    local required_keys=("$@")
    
    local validation_errors=0
    
    for key in "${required_keys[@]}"; do
        local value
        value=$(config_read_value "$section" "$key" "")
        
        if [[ -z "$value" ]]; then
            echo "ERROR: Required configuration missing: [$section] $key" >&2
            ((validation_errors++))
        fi
    done
    
    if [[ $validation_errors -gt 0 ]]; then
        return 1
    fi
    
    return 0
}

# List all keys in a section
# Usage: config_list_section <section>
# Returns: Space-separated list of keys
config_list_section() {
    local section="$1"
    
    if [[ -z "$CONFIG_FILE" ]]; then
        echo "ERROR: config_init not called" >&2
        return 1
    fi
    
    awk -v section="$section" '
        /^\['"$section"'\]/ { in_section=1; next }
        /^\[/ { in_section=0; next }
        in_section && /^[^#=]+=[^=]*$/ {
            sub(/=.*/, "")
            print
        }
    ' "$CONFIG_FILE" | tr '\n' ' ' | sed 's/[[:space:]]*$//'
    
    return 0
}

# Dump entire configuration (for debugging)
# Usage: config_dump <section>
# Returns: All key=value pairs in the section
config_dump() {
    local section="$1"
    
    if [[ -z "$CONFIG_FILE" ]]; then
        echo "ERROR: config_init not called" >&2
        return 1
    fi
    
    awk -v section="$section" '
        /^\['"$section"'\]/ { in_section=1; next }
        /^\[/ { in_section=0; next }
        in_section && /^[^#=]+=[^=]*$/ {
            print
        }
    ' "$CONFIG_FILE"
    
    return 0
}

# Get configured workflow states
# Usage: config_get_status_workflow
# Returns: Array-friendly space-separated list of workflow states
config_get_status_workflow() {
    local workflow
    workflow=$(config_read_array "workflows" "status_workflow")
    
    if [[ -z "$workflow" ]]; then
        echo "ERROR: status_workflow not configured in devenv.config [workflows] section" >&2
        return 1
    fi
    
    echo "$workflow"
    return 0
}
