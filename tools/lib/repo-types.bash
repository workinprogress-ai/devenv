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

get_type_ruleset_config_file() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    local result
    result=$(yq eval -r ".types.${repo_type}.rulesetConfigFile // \"null\"" "$config_path" 2>/dev/null || echo "null")
    # Normalize empty/null to "null" string
    if [ -z "$result" ] || [ "$result" = "null" ]; then
        echo "null"
    else
        echo "$result"
    fi
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

get_type_delete_pr_branch_on_merge() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    # Use 'has' to check if key exists, otherwise default to true
    local result
    result=$(yq eval ".types.${repo_type} | has(\"deletePRBranchOnMerge\")" "$config_path" 2>/dev/null)
    if [ "$result" = "true" ]; then
        yq eval -r ".types.${repo_type}.deletePRBranchOnMerge" "$config_path" 2>/dev/null || echo "true"
    else
        echo "true"
    fi
}

get_type_has_wiki() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    local result
    result=$(yq eval ".types.${repo_type} | has(\"hasWiki\")" "$config_path" 2>/dev/null)
    if [ "$result" = "true" ]; then
        yq eval -r ".types.${repo_type}.hasWiki" "$config_path" 2>/dev/null || echo "false"
    else
        echo "false"
    fi
}

get_type_has_issues() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    local result
    result=$(yq eval ".types.${repo_type} | has(\"hasIssues\")" "$config_path" 2>/dev/null)
    if [ "$result" = "true" ]; then
        yq eval -r ".types.${repo_type}.hasIssues" "$config_path" 2>/dev/null || echo "true"
    else
        echo "true"
    fi
}

get_type_has_discussions() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    local result
    result=$(yq eval ".types.${repo_type} | has(\"hasDiscussions\")" "$config_path" 2>/dev/null)
    if [ "$result" = "true" ]; then
        yq eval -r ".types.${repo_type}.hasDiscussions" "$config_path" 2>/dev/null || echo "false"
    else
        echo "false"
    fi
}

get_type_has_projects() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    local result
    result=$(yq eval ".types.${repo_type} | has(\"hasProjects\")" "$config_path" 2>/dev/null)
    if [ "$result" = "true" ]; then
        yq eval -r ".types.${repo_type}.hasProjects" "$config_path" 2>/dev/null || echo "false"
    else
        echo "false"
    fi
}

get_type_allow_auto_merge() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    local result
    result=$(yq eval ".types.${repo_type} | has(\"allowAutoMerge\")" "$config_path" 2>/dev/null)
    if [ "$result" = "true" ]; then
        yq eval -r ".types.${repo_type}.allowAutoMerge" "$config_path" 2>/dev/null || echo "true"
    else
        echo "true"
    fi
}

get_type_allow_update_branch() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    local result
    result=$(yq eval ".types.${repo_type} | has(\"allowUpdateBranch\")" "$config_path" 2>/dev/null)
    if [ "$result" = "true" ]; then
        yq eval -r ".types.${repo_type}.allowUpdateBranch" "$config_path" 2>/dev/null || echo "true"
    else
        echo "true"
    fi
}

get_type_allow_forking() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    local result
    result=$(yq eval ".types.${repo_type} | has(\"allowForking\")" "$config_path" 2>/dev/null)
    if [ "$result" = "true" ]; then
        yq eval -r ".types.${repo_type}.allowForking" "$config_path" 2>/dev/null || echo "false"
    else
        echo "false"
    fi
}

get_type_squash_merge_commit_title() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    local result
    result=$(yq eval ".types.${repo_type} | has(\"squashMergeCommitTitle\")" "$config_path" 2>/dev/null)
    if [ "$result" = "true" ]; then
        yq eval -r ".types.${repo_type}.squashMergeCommitTitle" "$config_path" 2>/dev/null || echo "PR_TITLE"
    else
        echo "PR_TITLE"
    fi
}

get_type_squash_merge_commit_message() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    local result
    result=$(yq eval ".types.${repo_type} | has(\"squashMergeCommitMessage\")" "$config_path" 2>/dev/null)
    if [ "$result" = "true" ]; then
        yq eval -r ".types.${repo_type}.squashMergeCommitMessage" "$config_path" 2>/dev/null || echo "COMMIT_MESSAGES"
    else
        echo "COMMIT_MESSAGES"
    fi
}

get_type_access() {
    local repo_type="$1"
    local config_path
    config_path=$(load_repo_types_config "${2:-}") || return 1
    
    # Check if access is defined for this type
    local result
    result=$(yq eval ".types.${repo_type} | has(\"access\")" "$config_path" 2>/dev/null)
    
    if [ "$result" = "true" ]; then
        # Return the access array as JSON
        yq eval -o json ".types.${repo_type}.access" "$config_path" 2>/dev/null || echo "[]"
    else
        # Return empty array when not specified
        echo '[]'
    fi
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

    # Get the ruleset config file property
    local ruleset_file
    ruleset_file=$(get_type_ruleset_config_file "$repo_type" "$config_path")

    if [ -z "$ruleset_file" ] || [ "$ruleset_file" = "null" ]; then
        log_info "No ruleset configured for this type"
        return 0
    fi

    log_info "Configuring repository ruleset from ${ruleset_file}..."

    # Build full path to ruleset JSON file
    local ruleset_json_path="${DEVENV_TOOLS}/config/${ruleset_file}"
    
    if ! validate_file_exists "$ruleset_json_path" "Ruleset JSON" 2>/dev/null; then
        log_warn "Ruleset file not found: ${ruleset_json_path}"
        return 0
    fi

    # Load and process the JSON with token replacement
    local payload_json
    payload_json=$(build_ruleset_payload_from_file "$ruleset_json_path" "$full_name" "$repo_type" "$config_path")
    
    if [ -z "$payload_json" ] || [ "$payload_json" = "{}" ]; then
        log_warn "Failed to generate valid ruleset payload from ${ruleset_file}"
        return 0
    fi

    # Extract ruleset name for logging and duplicate detection
    local ruleset_name
    ruleset_name=$(echo "$payload_json" | jq -r '.name' 2>/dev/null || echo "Unknown")

    # Check if ruleset already exists
    local existing_ruleset
    existing_ruleset=$(gh api "repos/${full_name}/rulesets" 2>/dev/null | jq -r ".[] | select(.name == \"$ruleset_name\") | .id" 2>/dev/null || echo "")

    # Create temp file for API payload
    local temp_payload
    temp_payload=$(mktemp)
    echo "$payload_json" > "$temp_payload"

    local ruleset_output
    if [ -n "$existing_ruleset" ]; then
        # Update existing via PUT
        ruleset_output=$(gh api --input "$temp_payload" -X PUT "repos/${full_name}/rulesets/${existing_ruleset}" 2>&1 || true)
        rm -f "$temp_payload"

        if echo "$ruleset_output" | jq -e '.id' >/dev/null 2>&1; then
            log_info "✓ Ruleset '${ruleset_name}' updated"
        elif echo "$ruleset_output" | grep -qi "403\|Upgrade to GitHub Pro\|make this repository public"; then
            log_warn "Rulesets require GitHub Pro or a public repository"
            log_info "Repository created successfully - rulesets can be configured later when upgrading"
        else
            log_warn "Ruleset update failed for '${ruleset_name}'"
            log_warn "API Response: $ruleset_output"
        fi
    else
        # Create new via POST
        ruleset_output=$(gh api --input "$temp_payload" -X POST "repos/${full_name}/rulesets" 2>&1 || true)
        rm -f "$temp_payload"

        if echo "$ruleset_output" | jq -e '.id' >/dev/null 2>&1; then
            log_info "✓ Ruleset '${ruleset_name}' configured"
        elif echo "$ruleset_output" | grep -qi "must be unique"; then
            log_info "⊘ Ruleset '${ruleset_name}' already exists (skipping)"
        elif echo "$ruleset_output" | grep -qi "403\|Upgrade to GitHub Pro\|make this repository public"; then
            log_warn "Rulesets require GitHub Pro or a public repository"
            log_info "Repository created successfully - rulesets can be configured later when upgrading"
        else
            log_warn "Ruleset configuration failed for '${ruleset_name}'"
            log_warn "API Response: $ruleset_output"
        fi
    fi
}

# Build ruleset JSON payload from file with token replacement
# Arguments:
#   $1 - Absolute path to ruleset JSON file
#   $2 - Full repository name (owner/repo)
#   $3 - Repository type key
#   $4 - Config path
# Returns: JSON payload on stdout
build_ruleset_payload_from_file() {
    local ruleset_file="$1"
    local full_name="$2"
    local repo_type="$3"
    local config_path="$4"
    
    if [ ! -f "$ruleset_file" ]; then
        echo "{}"
        return 1
    fi

    # Extract repo name and owner from full_name (owner/repo)
    local repo_name="${full_name#*/}"
    local owner="${full_name%/*}"
    
    # Get type description
    local type_description
    type_description=$(get_type_description "$repo_type" "$config_path")
    
    # Load JSON and replace tokens
    local payload
    payload=$(cat "$ruleset_file" | \
        sed "s/{{repo_name}}/${repo_name}/g" | \
        sed "s/{{owner}}/${owner}/g" | \
        sed "s/{{type_name}}/${repo_type}/g" | \
        sed "s/{{type_description}}/${type_description}/g" | \
        jq -c . 2>/dev/null)
    
    if [ -z "$payload" ] || [ "$payload" = "null" ]; then
        echo "{}"
        return 1
    fi
    
    echo "$payload"
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
    
    # Apply settings via GitHub API using -F flags for booleans (raw JSON)
    if gh api -X PATCH "repos/${full_name}" \
        -F "allow_merge_commit=$allow_merge" \
        -F "allow_squash_merge=$allow_squash" \
        -F "allow_rebase_merge=$allow_rebase" >/dev/null 2>&1; then
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

# Configure PR branch deletion on merge
# Arguments:
#   $1 - Full repository name (owner/repo)
#   $2 - Repository type
#   $3 - Optional config path (uses default if not provided)
# Returns: 0 on success, 1 on failure
configure_pr_branch_deletion_for_type() {
    local full_name="$1"
    local repo_type="$2"
    
    if [ -z "$full_name" ] || [ -z "$repo_type" ]; then
        log_error "Repository name and type required"
        return 1
    fi
    
    local config_path
    config_path=$(load_repo_types_config "${3:-}") || return 1
    
    # Get the setting (default to true for safety)
    local delete_pr_branch
    delete_pr_branch=$(get_type_delete_pr_branch_on_merge "$repo_type" "$config_path")
    
    log_info "Configuring PR branch deletion on merge..."
    
    # Apply setting via GitHub API using -F flag for boolean (raw JSON)
    if gh api -X PATCH "repos/${full_name}" \
        -F "delete_branch_on_merge=$delete_pr_branch" >/dev/null 2>&1; then
        log_info "✓ PR branch deletion on merge configured (enabled: $delete_pr_branch)"
        return 0
    else
        log_warn "Could not configure PR branch deletion (may require admin access)"
        return 0
    fi
}

configure_repository_features_for_type() {
    local full_name="$1"
    local repo_type="$2"
    
    if [ -z "$full_name" ] || [ -z "$repo_type" ]; then
        log_error "Repository name and type required"
        return 1
    fi
    
    local config_path
    config_path=$(load_repo_types_config "${3:-}") || return 1
    
    # Get all feature settings
    local has_wiki has_issues has_discussions has_projects
    local allow_auto_merge allow_update_branch allow_forking
    local squash_merge_commit_title squash_merge_commit_message
    
    has_wiki=$(get_type_has_wiki "$repo_type" "$config_path")
    has_issues=$(get_type_has_issues "$repo_type" "$config_path")
    has_discussions=$(get_type_has_discussions "$repo_type" "$config_path")
    has_projects=$(get_type_has_projects "$repo_type" "$config_path")
    allow_auto_merge=$(get_type_allow_auto_merge "$repo_type" "$config_path")
    allow_update_branch=$(get_type_allow_update_branch "$repo_type" "$config_path")
    allow_forking=$(get_type_allow_forking "$repo_type" "$config_path")
    squash_merge_commit_title=$(get_type_squash_merge_commit_title "$repo_type" "$config_path")
    squash_merge_commit_message=$(get_type_squash_merge_commit_message "$repo_type" "$config_path")
    
    log_info "Configuring repository features..."
    
    # Build API flags - use -F for booleans (raw JSON), -f for strings
    local api_flags=(-X PATCH "repos/${full_name}")
    api_flags+=(-F "has_wiki=$has_wiki" -F "has_issues=$has_issues" -F "has_discussions=$has_discussions" -F "has_projects=$has_projects")
    api_flags+=(-F "allow_auto_merge=$allow_auto_merge" -F "allow_update_branch=$allow_update_branch" -F "allow_forking=$allow_forking")
    api_flags+=(-f "squash_merge_commit_title=$squash_merge_commit_title" -f "squash_merge_commit_message=$squash_merge_commit_message")
    
    # Apply all settings via GitHub API in a single PATCH request
    if gh api "${api_flags[@]}" >/dev/null 2>&1; then
        log_info "✓ Repository features configured:"
        log_info "  - Wiki: $has_wiki, Issues: $has_issues, Discussions: $has_discussions, Projects: $has_projects"
        log_info "  - Auto-merge: $allow_auto_merge, Update branch: $allow_update_branch, Forking: $allow_forking"
        log_info "  - Squash merge: title=$squash_merge_commit_title, message=$squash_merge_commit_message"
        return 0
    else
        log_warn "Could not configure repository features (may require admin access)"
        return 0
    fi
}

# Configure repository permissions (collaborators and team access)
# Arguments:
#   $1 - Full repository name (owner/repo)
#   $2 - Repository type
#   $3 - Optional config path (uses default if not provided)
# Returns: 0 on success, 1 on failure
configure_repository_permissions_for_type() {
    local full_name="$1"
    local repo_type="$2"
    
    if [ -z "$full_name" ] || [ -z "$repo_type" ]; then
        log_error "Repository name and type required"
        return 1
    fi
    
    local config_path
    config_path=$(load_repo_types_config "${3:-}") || return 1
    
    log_info "Configuring repository permissions..."
    
    # Get access configuration as JSON array
    local access_json
    access_json=$(get_type_access "$repo_type" "$config_path")
    
    if [ -z "$access_json" ] || [ "$access_json" = "[]" ]; then
        log_info "No access configuration specified"
        return 0
    fi
    
    # Extract owner from full_name (owner/repo)
    local owner="${full_name%/*}"
    
    # Process each access entry
    local access_count
    access_count=$(echo "$access_json" | jq 'length' 2>/dev/null || echo "0")
    
    if [ "$access_count" -eq 0 ]; then
        log_info "No access entries to configure"
        return 0
    fi
    
    local success_count=0
    local skip_count=0
    local fail_count=0
    
    for ((i=0; i<access_count; i++)); do
        local name
        local type
        local permission
        
        name=$(echo "$access_json" | jq -r ".[$i].name" 2>/dev/null)
        type=$(echo "$access_json" | jq -r ".[$i].type // \"team\"" 2>/dev/null)
        permission=$(echo "$access_json" | jq -r ".[$i].permission" 2>/dev/null)
        
        if [ -z "$name" ] || [ "$name" = "null" ] || [ -z "$permission" ] || [ "$permission" = "null" ]; then
            log_warn "  ⊘ Skipping invalid access entry: name=$name, permission=$permission"
            ((skip_count++))
            continue
        fi
        
        # Apply permission based on type
        if [ "$type" = "team" ]; then
            # For teams, use the GitHub API to add team to repository
            # API endpoint: PUT /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}
            if gh api -X PUT "orgs/${owner}/teams/${name}/repos/${full_name}" \
                -f "permission=$permission" >/dev/null 2>&1; then
                log_info "  ✓ Team '$name' granted '$permission' permission"
                ((success_count++))
            else
                log_warn "  ✗ Failed to grant team '$name' permission (may not exist or lack admin access)"
                ((fail_count++))
            fi
        elif [ "$type" = "user" ]; then
            # For users, use the collaborator API
            # API endpoint: PUT /repos/{owner}/{repo}/collaborators/{username}
            if gh api -X PUT "repos/${full_name}/collaborators/${name}" \
                -f "permission=$permission" >/dev/null 2>&1; then
                log_info "  ✓ User '$name' granted '$permission' permission"
                ((success_count++))
            else
                log_warn "  ✗ Failed to grant user '$name' permission (may not exist or lack admin access)"
                ((fail_count++))
            fi
        else
            log_warn "  ⊘ Unknown access type '$type' for '$name'"
            ((skip_count++))
        fi
    done
    
    log_info "✓ Permission configuration complete: $success_count succeeded, $fail_count failed, $skip_count skipped"
    return 0
}