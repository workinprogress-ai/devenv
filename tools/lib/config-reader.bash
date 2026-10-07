#!/usr/bin/env bash
# config-reader.bash
# The one INI reader for devenv.config: every reader in the tooling (provider
# detection and identity, the policy layer, bootstrap, setup) goes through it.
#
# Rules, the same on every path:
#   - a section header and a key are matched exactly, never as a prefix or a pattern
#   - spaces and tabs around headers, keys and values are ignored, as are a trailing CR
#     (CRLF files), blank lines and full-line comments (# or ;)
#   - a value is everything after the first "=", so it may contain "="
#   - a key that is present twice reads as its last occurrence
#   - a key that is present but empty reads the same as an absent key: the caller's
#     default is returned
#
# Two ways to read:
#   config_get_raw FILE SECTION KEY [DEFAULT]   the literal value from FILE
#   config_get     FILE SECTION KEY [DEFAULT]   the same, with ${PROVIDER_ORG} and
#                                               ${PROVIDER_USER} expanded
# Both take the file explicitly and touch no global, so reading one file never
# changes what another reader sees. config_init / config_read_value / ... remain for
# callers that read one file repeatedly: config_init sets CONFIG_FILE and the
# config_read_* functions read it.
# Token variables are never interpolated: a config file is a persistent surface and
# must not carry or expand secrets.

# Guard against multiple sourcing
if [ -n "${_CONFIG_READER_LOADED:-}" ]; then return 0; fi
_CONFIG_READER_LOADED=1

# The scanner every reader shares: prints the value of SECTION/KEY in FILE, or nothing.
# Usage: _config_scan FILE SECTION KEY [WARN_DUPLICATES: 1|0]
_config_scan() {
    awk -v section="$2" -v key="$3" -v warn="${4:-0}" -v conffile="$1" '
        { line = $0; sub(/\r$/, "", line); gsub(/^[ \t]+|[ \t]+$/, "", line) }
        match(line, /^\[[^]]*\]/) {
            # anything after the closing bracket (a trailing comment) is ignored
            name = substr(line, 2, RLENGTH - 2)
            gsub(/^[ \t]+|[ \t]+$/, "", name)
            in_section = (name == section)
            next
        }
        !in_section || line == "" || line ~ /^[#;]/ { next }
        {
            idx = index(line, "=")
            if (idx == 0) next
            k = substr(line, 1, idx - 1); gsub(/[ \t]+$/, "", k)
            if (k != key) next
            v = substr(line, idx + 1); gsub(/^[ \t]+/, "", v)
            if (seen++ && warn) {
                printf "WARNING: duplicate key %s.%s in %s (line %d) — using last value\n", section, key, conffile, NR > "/dev/stderr"
            }
            val = v
        }
        END { if (seen) print val }
    ' "$1"
}

# Expand the template variables in a value: ${PROVIDER_ORG} and ${PROVIDER_USER},
# through the provider identity accessors when the provider layer is loaded. The
# accessors read RAW values, so this cannot re-enter the reader. Parameter
# expansion (not sed), so values containing "/" or "&" cannot break the
# substitution and secret values never transit a process argument.
_config_expand() {
    local value="$1"
    if declare -F provider_org_get >/dev/null; then
        local org_res user_res
        org_res=$(provider_org_get 2>/dev/null || true)
        user_res=$(provider_user_get 2>/dev/null || true)
        # Single-pass expansion: each token is replaced over the ORIGINAL value only.
        # A token spelling arriving inside an accessor-resolved value is neutralized
        # with a sentinel that no later pass matches, so sequential replaces cannot
        # re-expand substituted content.
        local sentinel=$'\x01'
        org_res="${org_res//\$\{/$sentinel\{}"
        user_res="${user_res//\$\{/$sentinel\{}"
        value="${value//\$\{PROVIDER_ORG\}/${org_res:-}}"
        value="${value//\$\{PROVIDER_USER\}/${user_res:-}}"
        value="${value//$sentinel/\$}"
    fi
    printf '%s' "$value"
}

# Read a literal value from FILE (no expansion). Returns 1, printing nothing, when
# the file does not exist.
# Usage: config_get_raw FILE SECTION KEY [DEFAULT]
config_get_raw() {
    local file="$1" section="$2" key="$3" default="${4:-}"
    [ -f "$file" ] || return 1
    local value
    value=$(_config_scan "$file" "$section" "$key" 0)
    printf '%s\n' "${value:-$default}"
}

# Read a value from FILE with ${PROVIDER_ORG}/${PROVIDER_USER} expanded. Returns 1,
# printing nothing, when the file does not exist. A repeated key warns on stderr.
# Usage: config_get FILE SECTION KEY [DEFAULT]
config_get() {
    local file="$1" section="$2" key="$3" default="${4:-}"
    [ -f "$file" ] || return 1
    local value
    value=$(_config_scan "$file" "$section" "$key" 1)
    [ -n "$value" ] || value="$default"
    printf '%s\n' "$(_config_expand "$value")"
}

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

# Read a single value from the file config_init selected.
# Usage: config_read_value <section> <key> [default_value]
# Returns: The value with template variables expanded, or default_value if not found
config_read_value() {
    local section="$1"
    local key="$2"
    local default="${3:-}"

    if [[ -z "$CONFIG_FILE" ]]; then
        echo "ERROR: config_init not called" >&2
        return 1
    fi
    config_get "$CONFIG_FILE" "$section" "$key" "$default"
}


# Read a single value RAW: no template expansion. Exists for the provider identity
# accessors, which must read the config's literal values (expanding there would
# re-enter the accessors — recursion).
# Usage: config_read_value_raw <section> <key> [default_value]
config_read_value_raw() {
    local section="$1"
    local key="$2"
    local default="${3:-}"

    if [[ -z "$CONFIG_FILE" ]]; then
        echo "ERROR: config_init not called" >&2
        return 1
    fi
    config_get_raw "$CONFIG_FILE" "$section" "$key" "$default"
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

# Print the key=value lines of a section, trimmed (comments and blanks skipped).
# Usage: _config_section_lines FILE SECTION
_config_section_lines() {
    awk -v section="$2" '
        { line = $0; sub(/\r$/, "", line); gsub(/^[ \t]+|[ \t]+$/, "", line) }
        match(line, /^\[[^]]*\]/) {
            name = substr(line, 2, RLENGTH - 2); gsub(/^[ \t]+|[ \t]+$/, "", name)
            in_section = (name == section); next
        }
        !in_section || line == "" || line ~ /^[#;]/ { next }
        {
            idx = index(line, "="); if (idx == 0) next
            k = substr(line, 1, idx - 1); gsub(/[ \t]+$/, "", k)
            v = substr(line, idx + 1); gsub(/^[ \t]+/, "", v)
            print k "=" v
        }
    ' "$1"
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

    _config_section_lines "$CONFIG_FILE" "$section" | sed 's/=.*//' | tr '\n' ' ' | sed 's/[[:space:]]*$//'

    return 0
}

# Dump a section (for debugging)
# Usage: config_dump <section>
# Returns: All key=value pairs in the section
config_dump() {
    local section="$1"

    if [[ -z "$CONFIG_FILE" ]]; then
        echo "ERROR: config_init not called" >&2
        return 1
    fi

    _config_section_lines "$CONFIG_FILE" "$section"

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


