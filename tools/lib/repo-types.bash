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
    pattern=$(yq eval -r ".types.${repo_type}.naming_pattern // \"\"" "$config_path" 2>/dev/null || true)

    if [ -z "$pattern" ] || [ "$pattern" = "null" ]; then
        log_error "Unknown repository type '$repo_type'"
        log_info "Valid types:"
        yq eval '.types | keys[]' "$config_path" | sed 's/^/  /' >&2
        return 1
    fi

    if ! echo "$repo_name" | grep -qE "$pattern"; then
        local example
        example=$(yq eval ".types.${repo_type}.naming_example" "$config_path")
        log_error "Repository name '$repo_name' does not match pattern for type '$repo_type'"
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
        pattern=$(yq eval ".types.${type}.naming_pattern" "$config_path" 2>/dev/null)
        
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
    apply_ruleset=$(yq eval -r ".types.${repo_type}.applyRuleset // false" "$config_path" 2>/dev/null)

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
        local enforcement

        ruleset_name=$(yq eval -r ".types.${repo_type}.rulesets[$i].name" "$config_path")
        enforcement=$(yq eval -r ".types.${repo_type}.rulesets[$i].enforcement" "$config_path")

        cat > "$temp_payload" <<EOF
{
  "name": "$ruleset_name",
  "target": "branch",
  "enforcement": "$enforcement",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/master"]
    }
  },
  "rules": $(yq eval -r ".types.${repo_type}.rulesets[$i].rules" "$config_path")
}
EOF

        local ruleset_output
        ruleset_output=$(gh api --input "$temp_payload" -X POST "repos/${full_name}/rulesets" 2>&1 || true)

        if echo "$ruleset_output" | grep -q "\"id\""; then
            log_info "✓ Ruleset '$ruleset_name' configured"
        elif echo "$ruleset_output" | grep -qi "403\|Upgrade to GitHub Pro\|make this repository public"; then
            log_warn "Rulesets require GitHub Pro or a public repository"
            log_info "Repository created successfully - rulesets can be configured later when upgrading"
            rm -f "$temp_payload"
            return 0
        else
            log_info "Ruleset configuration skipped (may require Pro account)"
        fi
    done
    
    # Clean up temp file
    rm -f "$temp_payload"
}
