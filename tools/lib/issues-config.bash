#!/usr/bin/env bash
# issues-config.bash - Helpers for GitHub issue type configuration
#
# All issue type data (names, descriptions, IDs) is read from
# tools/config/issues-config.yml (the single source of truth).

# Guard against multiple sourcing
if [ -n "${_ISSUES_CONFIG_LIB_LOADED:-}" ]; then
    return 0
fi
_ISSUES_CONFIG_LIB_LOADED=1

# Ensure dependencies are available for logging and validation
if [ -z "${_ERROR_HANDLING_LOADED:-}" ] && [ -f "${DEVENV_TOOLS}/lib/error-handling.bash" ]; then
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/error-handling.bash"
fi

if [ -z "${_VALIDATION_LOADED:-}" ] && [ -f "${DEVENV_TOOLS}/lib/validation.bash" ]; then
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/validation.bash"
fi

# Get the issues config path, honoring overrides and defaults
issues_config_path() {
    local override="${1:-}"

    if [ -n "$override" ]; then
        echo "$override"
        return 0
    fi

    if [ -n "${ISSUES_CONFIG:-}" ]; then
        echo "$ISSUES_CONFIG"
        return 0
    fi

    echo "${DEVENV_TOOLS}/config/issues-config.yml"
}

# Load and validate the issues config path
load_issues_config() {
    local config_path
    config_path=$(issues_config_path "${1:-}") || return 1

    if ! validate_file_exists "$config_path" "Issues config"; then
        return 1
    fi

    echo "$config_path"
}

# Get all available issue types
get_issue_types() {
    local config_path
    config_path=$(load_issues_config "${1:-}") || return 1
    yq eval '.types[].name' "$config_path" 2>/dev/null || return 1
}

# Get issue type description
get_issue_type_description() {
    local type_name="$1"
    local config_path
    config_path=$(load_issues_config "${2:-}") || return 1
    yq eval ".types[] | select(.name == \"$type_name\") | .description" "$config_path" 2>/dev/null || return 1
}

# Get GitHub issue type ID for a given type name
get_issue_type_id() {
    local type_name="$1"
    local config_path
    config_path=$(load_issues_config "${2:-}") || return 1
    yq eval ".types[] | select(.name == \"$type_name\") | .id" "$config_path" 2>/dev/null || return 1
}

# Validate that an issue type exists in config
validate_issue_type() {
    local type_to_validate="$1"
    local config_path
    config_path=$(load_issues_config "${2:-}") || return 1

    local type_list
    type_list=$(get_issue_types "$config_path") || return 1

    while IFS= read -r valid_type; do
        if [ "$valid_type" = "$type_to_validate" ]; then
            return 0
        fi
    done <<< "$type_list"

    log_error "Invalid issue type: $type_to_validate"
    return 1
}

# Get all available types as array (for fzf selection)
# Returns space-separated type names
get_issue_types_array() {
    local config_path
    config_path=$(load_issues_config "${1:-}") || return 1

    get_issue_types "$config_path" | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}

# ==========================================================================
# Planning Configuration (requirements doc → issue type mapping)
# ==========================================================================

# Get the planning type mapping for a given concept (phases, features, tasks)
# Usage: get_planning_type_mapping <concept> [config_path]
# Returns: The issue type name mapped to the concept
get_planning_type_mapping() {
    local concept="$1"
    local config_path
    config_path=$(load_issues_config "${2:-}") || return 1
    local value
    value=$(yq eval ".planning.type_mapping.$concept // \"\"" "$config_path" 2>/dev/null) || return 1
    if [ -z "$value" ]; then
        echo "ERROR: No planning type mapping found for '$concept'" >&2
        return 1
    fi
    echo "$value"
}

# Get all planning type mappings as key=value lines
# Usage: get_planning_type_mappings [config_path]
# Returns: newline-delimited "concept=IssueType" pairs
get_planning_type_mappings() {
    local config_path
    config_path=$(load_issues_config "${1:-}") || return 1
    local keys
    keys=$(yq eval '.planning.type_mapping | keys | .[]' "$config_path" 2>/dev/null) || return 1
    if [ -z "$keys" ]; then
        echo "ERROR: No planning type mappings found" >&2
        return 1
    fi
    while IFS= read -r key; do
        local val
        val=$(yq eval ".planning.type_mapping.$key" "$config_path" 2>/dev/null)
        echo "$key=$val"
    done <<< "$keys"
}

# ==========================================================================
# Organization Issue Types Sync (uses GH_ORG)
# ==========================================================================

# Fetch organization issue types with IDs via GitHub GraphQL
# Usage: fetch_org_issue_type_ids [org]
# Env: GH_ORG (used if no org param provided)
# Output: newline-delimited "NAME\tID"
fetch_org_issue_type_ids() {
    local org="${1:-${GH_ORG:-}}"
    if [ -z "$org" ]; then
        echo "ERROR: Organization not specified. Set GH_ORG or pass org as parameter" >&2
        return 1
    fi

    if ! command -v gh >/dev/null 2>&1; then
        echo "ERROR: gh CLI is required" >&2
        return 1
    fi
    if ! command -v jq >/dev/null 2>&1; then
        echo "ERROR: jq is required" >&2
        return 1
    fi

    local query
    query='query { organization(login: "'$org'") { issueTypes(first: 100) { edges { node { id name } } } } }'

    local result
    result=$(gh api graphql -f query="$query" 2>/dev/null) || return 1

    echo "$result" | jq -r '.data.organization.issueTypes.edges[] | "\(.node.name)\t\(.node.id)"'
}

# Exported functions
export -f issues_config_path
export -f load_issues_config
export -f get_issue_types
export -f get_issue_type_description
export -f get_issue_type_id
export -f validate_issue_type
export -f get_issue_types_array
export -f fetch_org_issue_type_ids
export -f get_planning_type_mapping
export -f get_planning_type_mappings
