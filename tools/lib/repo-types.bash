#!/usr/bin/env bash
# repo-types.bash - Helpers for repository type configuration and ruleset setup

# Guard against multiple sourcing
if [ -n "${_REPO_TYPES_LIB_LOADED:-}" ]; then
    return 0
fi
_REPO_TYPES_LIB_LOADED=1

# Ensure dependencies are available for logging and validation
if [ -z "${_ERROR_HANDLING_LOADED:-}" ] && [ -f "${DEVENV_TOOLS}/lib/error-handling.bash" ]; then
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/error-handling.bash"
fi

if [ -z "${_VALIDATION_LOADED:-}" ] && [ -f "${DEVENV_TOOLS}/lib/validation.bash" ]; then
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/validation.bash"
fi

# Get the repo types config path, honoring overrides and defaults
repo_types_config_path() {
    local override="${1:-}"

    if [ -n "$override" ]; then
        echo "$override"
        return 0
    fi

    if [ -n "${REPO_TYPES_CONFIG:-}" ]; then
        echo "$REPO_TYPES_CONFIG"
        return 0
    fi

    echo "${DEVENV_TOOLS}/config/repo-types.yaml"
}

# Load and validate the repo types config path
load_repo_types_config() {
    local config_path
    config_path=$(repo_types_config_path "${1:-}") || return 1

    if ! validate_file_exists "$config_path" "Repo types config"; then
        return 1
    fi

    echo "$config_path"
}

# Helpers to safely read type configuration values with sensible defaults
# All functions accept (repo_type, [config_path]) and return a value

get_type_main_branch() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    yq eval -r ".types.${repo_type}.mainBranch // \"master\"" "$config_path" 2>/dev/null || echo "master"
}

get_type_template() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    yq eval -r ".types.${repo_type}.template // \"null\"" "$config_path" 2>/dev/null || echo "null"
}

get_type_apply_ruleset() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    yq eval -r ".types.${repo_type}.applyRuleset // false" "$config_path" 2>/dev/null || echo "false"
}

get_type_allowed_merge_types() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    # Return compact JSON array string without newline
    local val
    val=$(yq eval -o json ".types.${repo_type}.allowedMergeTypes // [\"merge\"]" "$config_path" 2>/dev/null || echo '["merge"]')
    # Compact to remove whitespace
    val=$(echo "$val" | jq -c . 2>/dev/null || echo '["merge"]')
    if [ -z "$val" ] || [ "$val" = "null" ]; then
        val='["merge"]'
    fi
    printf '%s' "$val"
}

get_type_is_template() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    yq eval -r ".types.${repo_type}.isTemplate // false" "$config_path" 2>/dev/null || echo "false"
}

get_type_post_creation_script() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    yq eval -r ".types.${repo_type}.post_creation_script // \"\"" "$config_path" 2>/dev/null || echo ""
}

get_type_delete_post_creation_script() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    yq eval -r ".types.${repo_type}.delete_post_creation_script // true" "$config_path" 2>/dev/null || echo "true"
}

get_type_post_creation_commit_handling() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    yq eval -r ".types.${repo_type}.post_creation_commit_handling // \"none\"" "$config_path" 2>/dev/null || echo "none"
}

# Additional getters for consumer scripts
get_type_description() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    yq eval -r ".types.${repo_type}.description // \"No description\"" "$config_path" 2>/dev/null || echo "No description"
}

get_type_naming_pattern() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    # Empty string default to signal unknown type
    yq eval -r ".types.${repo_type}.naming_pattern // \"\"" "$config_path" 2>/dev/null || echo ""
}

get_type_naming_example() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    yq eval -r ".types.${repo_type}.naming_example // \"name.example\"" "$config_path" 2>/dev/null || echo "name.example"
}

# Validate a repository name against the configured type naming pattern
validate_repo_type() {
    local repo_name="$1"
    local repo_type="$2"

    if [ "$repo_type" = "none" ]; then
        return 0
    fi

    local config_path
    config_path=$(load_repo_types_config "${3:-}") || return 1

    local pattern
    pattern=$(get_type_naming_pattern "$repo_type" "$config_path")

    if [ -z "$pattern" ] || [ "$pattern" = "null" ]; then
        log_error "Unknown repository type '$repo_type'"
        log_info "Valid types:"
        yq eval '.types | keys[]' "$config_path" | sed 's/^/  /' >&2
        return 1
    fi

    # Extract just the repo name from owner/repo format if provided
    local extracted_name="$repo_name"
    if [[ "$repo_name" == *"/"* ]]; then
        extracted_name="${repo_name##*/}"
    fi

    if ! echo "$extracted_name" | grep -qE "$pattern"; then
        local example
        example=$(get_type_naming_example "$repo_type" "$config_path")
        log_error "Repository name '$extracted_name' does not match pattern for type '$repo_type'"
        log_info "Expected pattern: $example"
        return 1
    fi
}

# Detect repository type by matching repo name against naming patterns in config
# Arguments:
#   $1 - Full repository name (owner/repo-name) or just repo name
#   $2 - Optional config path (uses default if not provided)
#   $3 - Optional prompt mode: "prompt" to ask user if no match, "silent" to return empty
# Returns: The detected repo type on stdout, or empty string if not found
detect_repo_type() {
    local full_name="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    local prompt_mode="${3:-prompt}"
    
    # Extract just the repo name (after the /)
    local repo_name="${full_name#*/}"
    
    # Try to match repo name against each type's naming pattern
    local types
    types=$(yq eval '.types | keys[]' "$config_path" 2>/dev/null)
    
    while IFS= read -r type; do
        local pattern
        pattern=$(get_type_naming_pattern "$type" "$config_path")
        
        if [ "$pattern" != "null" ] && [[ "$repo_name" =~ $pattern ]]; then
            echo "$type"
            return 0
        fi
    done <<< "$types"
    
    # No match found
    if [ "$prompt_mode" = "prompt" ]; then
        log_warn "Could not auto-detect repo type from name: $repo_name"
        echo ""
        echo "Available repository types:" >&2
        # shellcheck disable=SC2016
        yq eval '.types | keys[] as $k | "  - \($k): " + .[$k].naming_example' "$config_path" 2>/dev/null || true
        echo "" >&2
        read -r -p "Enter repository type: " repo_type < /dev/tty
        echo "$repo_type"
        return 0
    fi
    
    # Silent mode - just return empty
    return 1
}

# Configure GitHub repository rulesets for a repo type
configure_rulesets_for_type() {
    local full_name="$1"
    local repo_type="$2"
    local config_path
    config_path=$(repo_types_config_path "${3:-}")

    if ! validate_file_exists "$config_path" "Repo types config" 2>/dev/null; then
        log_info "Ruleset configuration skipped (config not found)"
        return 0
    fi

    local apply_ruleset
    apply_ruleset=$(get_type_apply_ruleset "$repo_type" "$config_path")

    if [ "$apply_ruleset" != "true" ]; then
        log_info "Ruleset configuration disabled for this type"
        return 0
    fi

    log_info "Configuring repository rulesets..."

    local rulesets_json
    rulesets_json=$(yq eval -r ".types.${repo_type}.rulesets" "$config_path" 2>/dev/null)

    if [ -z "$rulesets_json" ] || [ "$rulesets_json" = "null" ] || [ "$rulesets_json" = "[]" ]; then
        log_info "No rulesets configured for type '$repo_type'"
        return 0
    fi

    local temp_payload
    temp_payload=$(mktemp)

    local rulesets_count
    rulesets_count=$(yq eval ".types.${repo_type}.rulesets | length" "$config_path")
    local i
    for ((i=0; i<rulesets_count; i++)); do
        local ruleset_name

        ruleset_name=$(yq eval -r ".types.${repo_type}.rulesets[$i].name" "$config_path")

        # Validate required fields
        if [ -z "$ruleset_name" ] || [ "$ruleset_name" = "null" ]; then
            log_warn "Ruleset name is missing at index $i, skipping"
            continue
        fi

        # Check if ruleset already exists
        local existing_ruleset
        existing_ruleset=$(gh api "repos/${full_name}/rulesets" 2>/dev/null | jq -r ".[] | select(.name == \"$ruleset_name\") | .id" 2>/dev/null || echo "")
        
        if [ -n "$existing_ruleset" ]; then
            log_info "⊘ Ruleset '$ruleset_name' already exists (skipping)"
            continue
        fi

        # Generate JSON payload with proper defaults
        # Use yq to build the complete ruleset JSON with defaults for missing fields
        local payload_json
                payload_json=$(yq eval -o json "
                {
                    \"name\": .types.${repo_type}.rulesets[$i].name,
                    \"target\": \"branch\",
                    \"enforcement\": (.types.${repo_type}.rulesets[$i].enforcement // \"active\"),
                    \"conditions\": (.types.${repo_type}.rulesets[$i].conditions // {\"ref_name\": {\"include\": [\"refs/heads/master\"], \"exclude\": []}}),
                    \"rules\": (.types.${repo_type}.rulesets[$i].rules // [])
                }
                " "$config_path" 2>/dev/null || echo "{}")

        # Validate the payload is not empty or just whitespace
        if [ -z "$payload_json" ] || [ "$payload_json" = "{}" ]; then
            log_warn "Failed to generate valid JSON payload for ruleset '$ruleset_name'"
            continue
        fi

        echo "$payload_json" > "$temp_payload"

        local ruleset_output
        ruleset_output=$(gh api --input "$temp_payload" -X POST "repos/${full_name}/rulesets" 2>&1 || true)

        if echo "$ruleset_output" | grep -q "\"id\""; then
            log_info "✓ Ruleset '$ruleset_name' configured"
        elif echo "$ruleset_output" | grep -qi "must be unique"; then
            log_info "⊘ Ruleset '$ruleset_name' already exists (skipping)"
        elif echo "$ruleset_output" | grep -qi "403\|Upgrade to GitHub Pro\|make this repository public"; then
            log_warn "Rulesets require GitHub Pro or a public repository"
            log_info "Repository created successfully - rulesets can be configured later when upgrading"
            rm -f "$temp_payload"
            return 0
        else
            log_warn "Ruleset configuration failed for '$ruleset_name'"
            log_warn "API Response: $ruleset_output"
        fi
    done
    
    # Clean up temp file
    rm -f "$temp_payload"
}

# Configure allowed merge types for a repository
# Arguments:
#   $1 - Full repository name (owner/repo)
#   $2 - Repository type
#   $3 - Optional config path (uses default if not provided)
# Returns: 0 on success, 1 on failure
configure_merge_types_for_type() {
    local full_name="$1"
    local repo_type="$2"
    
    if [ -z "$full_name" ] || [ -z "$repo_type" ]; then
        log_error "Repository name and type required"
        return 1
    fi
    
    local config_path
    config_path=$(load_repo_types_config "${3:-}") || return 1
    
    log_info "Configuring merge types for repository..."
    
    # Get allowed merge types (JSON array string) via getter with defaults
    local merge_json
    merge_json=$(get_type_allowed_merge_types "$repo_type" "$config_path")
    
    # Map the merge type names to boolean settings required by GitHub API
    # The array should contain values like: "merge", "squash", "rebase"
    # We need to set: allow_merge_commit, allow_squash_merge, allow_rebase_merge
    
    local allow_merge=false
    local allow_squash=false
    local allow_rebase=false
    
    # Check each allowed type
    if echo "$merge_json" | jq -e '.[] | select(. == "merge")' >/dev/null 2>&1; then
        allow_merge=true
    fi
    if echo "$merge_json" | jq -e '.[] | select(. == "squash")' >/dev/null 2>&1; then
        allow_squash=true
    fi
    if echo "$merge_json" | jq -e '.[] | select(. == "rebase")' >/dev/null 2>&1; then
        allow_rebase=true
    fi
    
    # Apply settings via GitHub API using -f flags
    if gh api -X PATCH "repos/${full_name}" \
        -f "allow_merge_commit=$allow_merge" \
        -f "allow_squash_merge=$allow_squash" \
        -f "allow_rebase_merge=$allow_rebase" >/dev/null 2>&1; then
        log_info "✓ Merge types configured (merge: $allow_merge, squash: $allow_squash, rebase: $allow_rebase)"
        return 0
    else
        log_warn "Could not configure merge types (may require admin access or Pro account)"
        return 0
    fi
}
# Configure repository template setting
# Arguments:
#   $1 - Full repository name (owner/repo)
#   $2 - Repository type
#   $3 - Optional config path (uses default if not provided)
# Returns: 0 on success, 1 on failure
configure_template_setting_for_type() {
    local full_name="$1"
    local repo_type="$2"
    
    if [ -z "$full_name" ] || [ -z "$repo_type" ]; then
        log_error "Repository name and type required"
        return 1
    fi
    
    local config_path
    config_path=$(load_repo_types_config "${3:-}") || return 1
    
    # Check if this type should be marked as a template
    local is_template
    is_template=$(get_type_is_template "$repo_type" "$config_path")
    
    if [ "$is_template" = "true" ]; then
        log_info "Marking repository as a template..."
        if gh repo edit "$full_name" --template >/dev/null 2>&1; then
            log_info "✓ Repository marked as template"
            return 0
        else
            log_warn "Could not mark repository as template (may require admin access)"
            return 0
        fi
    else
        log_info "Repository template setting: not a template"
        return 0
    fi
}