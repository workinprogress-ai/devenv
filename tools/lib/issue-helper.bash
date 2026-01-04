#!/usr/bin/env bash
# issue-helper.bash
# Helper functions for issue management scripts
# Provides: load_issue_types_from_config(), build_type_menu()

# Load issue types from configuration
# Usage: load_issue_types_from_config [config_file]
# Returns: Sets ISSUE_TYPES array globally, exits on error
# Note: Issue type names must be single words or hyphenated (e.g., story, bug, feature-request)
#       Multi-word names will not work correctly with bash array splitting
load_issue_types_from_config() {
    local config_file="${1:-$DEVENV_ROOT/devenv.config}"
    
    # Initialize empty array
    ISSUE_TYPES=()
    
    # Config file is mandatory
    if [[ ! -f "$config_file" ]]; then
        echo "ERROR: devenv.config not found at $config_file" >&2
        return 1
    fi
    
    # Config-reader must be available
    if ! command -v config_init >/dev/null 2>&1; then
        echo "ERROR: config_init function not available" >&2
        return 1
    fi
    
    # Initialize and read config
    if ! config_init "$config_file"; then
        echo "ERROR: Failed to initialize config reader" >&2
        return 1
    fi
    
    # Load issue types - mandatory field
    local types
    types=$(config_read_array "workflows" "issue_types")
    if [[ -z "$types" ]]; then
        echo "ERROR: issue_types not configured in devenv.config [workflows] section" >&2
        return 1
    fi
    
    read -ra ISSUE_TYPES <<< "$types"
    return 0
}

# Build dynamic menu for selecting issue type
# Usage: build_type_menu
# Outputs numbered menu options
build_type_menu() {
    local i=1
    for issue_type in "${ISSUE_TYPES[@]}"; do
        # Capitalize first letter
        local display_name="${issue_type^}"
        echo "  $i) $display_name"
        ((i++))
    done
}

# Get issue type label from choice
# Usage: get_type_label_from_choice <choice_number>
# Returns: type:TYPE label
get_type_label_from_choice() {
    local choice="$1"
    
    # Convert to zero-based index
    local index=$((choice - 1))
    
    if [[ $index -ge 0 ]] && [[ $index -lt ${#ISSUE_TYPES[@]} ]]; then
        echo "type:${ISSUE_TYPES[$index]}"
        return 0
    fi
    
    return 1
}

# Get all type labels for removal
# Usage: get_all_type_labels
# Returns: Space-separated list of type:TYPE labels
get_all_type_labels() {
    for issue_type in "${ISSUE_TYPES[@]}"; do
        echo -n "type:$issue_type "
    done
}
