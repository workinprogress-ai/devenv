#!/bin/bash

################################################################################
# artifacts-list.sh
#
# List and filter artifacts from GitHub Packages
#
# Usage:
#   ./artifacts-list.sh --owner <org> [--type <type>] [--name <name>] [--format <format>]
#
# Description:
#   Lists artifacts (packages) from GitHub Packages with support for filtering
#   by type (npm, nuget, docker, etc.) and name patterns. Outputs results as a
#   formatted table showing package name, type, and URL. Can also output raw
#   JSON for scripting or piping to other tools.
#
# Options:
#   --owner <org>         Repository owner/organization (required)
#   --type <type>         Filter by package type (npm, nuget, docker, maven, 
#                         rubygems, gradle, cargo)
#   --name <pattern>      Filter packages by name (partial match, case-insensitive)
#   --format <format>     Output format: table (default), json
#   --repo <repo>         Specific repository to query (optional)
#   --sort <field>        Sort by field: name (default), type, created_at, 
#                         updated_at
#   --versions <pkg>      List versions for a specific package (requires --type 
#                         and --owner)
#   --help                Show this help message
#
# Examples:
#   # List all npm packages in an organization
#   ./artifacts-list.sh --owner myorg --type npm
#
#   # List all nuget packages with "service" in the name
#   ./artifacts-list.sh --owner myorg --type nuget --name service
#
#   # List versions for a specific npm package
#   ./artifacts-list.sh --owner myorg --type npm --name my-package --versions
#
#   # Output as JSON for scripting
#   ./artifacts-list.sh --owner myorg --format json | jq '.[] | .name'
#
# Dependencies:
#   - gh (GitHub CLI)
#   - jq (JSON query tool)
#   - column (text formatter)
#   - artifact-operations.bash
#   - error-handling.bash
#   - github-helpers.bash
#
################################################################################

set -euo pipefail

# Source required libraries
source "${DEVENV_TOOLS}/lib/error-handling.bash"
source "${DEVENV_TOOLS}/lib/github-helpers.bash"
source "${DEVENV_TOOLS}/lib/artifact-operations.bash"

# ============================================================================
# Formatting Functions
# ============================================================================

# Format packages as a table
# Usage: format_packages_table JSON_ARRAY [--sort FIELD]
# Arguments:
#   JSON_ARRAY    JSON array of package objects (from query_packages)
#   --sort FIELD  Sort by field (name, type, updated_at, created_at)
# Returns: Formatted table output
format_packages_table() {
    local json_data="$1"
    local sort_field="name"

    # Parse sort field if provided
    if [ -n "${2:-}" ] && [ "$2" = "--sort" ] && [ -n "${3:-}" ]; then
        sort_field="$3"
    fi

    # Validate sort field
    case "$sort_field" in
        name|type|created_at|updated_at|package_type)
            # Valid sort fields
            ;;
        *)
            log_error "Invalid sort field: $sort_field"
            return 1
            ;;
    esac

    # Normalize sort field name for JSON
    local json_sort_field="$sort_field"
    if [ "$sort_field" = "type" ]; then
        json_sort_field="package_type"
    fi

    # Format as table using jq and column
    if echo "$json_data" | jq -e '.' >/dev/null 2>&1; then
        # Use jq to extract and format fields
        echo "$json_data" | jq -r \
            "sort_by(.$json_sort_field) | .[] | [
                .name // \"-\",
                .package_type // \"-\",
                .html_url // .url // \"-\"
            ] | @tsv" | \
            (echo -e "NAME\tTYPE\tURL"; cat) | \
            column -t -s $'\t'
    else
        log_error "Invalid JSON data provided to format_packages_table"
        return 1
    fi
}

# Format package versions as a table
# Usage: format_versions_table JSON_ARRAY [--sort FIELD]
# Arguments:
#   JSON_ARRAY    JSON array of version objects (from get_package_versions)
#   --sort FIELD  Sort by field (version, created_at, updated_at)
# Returns: Formatted table output
format_versions_table() {
    local json_data="$1"
    local sort_field="version"

    # Parse sort field if provided
    if [ -n "${2:-}" ] && [ "$2" = "--sort" ] && [ -n "${3:-}" ]; then
        sort_field="$3"
    fi

    # Validate sort field
    case "$sort_field" in
        version|name|created_at|updated_at)
            # Valid sort fields
            ;;
        *)
            log_error "Invalid sort field: $sort_field"
            return 1
            ;;
    esac

    # Format as table using jq and column
    if echo "$json_data" | jq -e '.' >/dev/null 2>&1; then
        # Use jq to extract and format fields with human-readable dates
        echo "$json_data" | jq -r \
            "sort_by(.$sort_field) | reverse | .[] | [
                .version // .name // \"-\",
                (.created_at // \"\" | gsub(\"T\"; \" \") | gsub(\"Z\"; \"\")),
                (.updated_at // \"\" | gsub(\"T\"; \" \") | gsub(\"Z\"; \"\"))
            ] | @tsv" | \
            (echo -e "VERSION\tPUBLISHED\tUPDATED"; cat) | \
            column -t -s $'\t'
    else
        log_error "Invalid JSON data provided to format_versions_table"
        return 1
    fi
}

# Format raw package/version output as JSON
# Usage: format_json OUTPUT
# Arguments:
#   OUTPUT - Raw output to format
# Returns: Pretty-printed JSON
format_json() {
    local data="$1"
    
    if echo "$data" | jq -e '.' >/dev/null 2>&1; then
        echo "$data" | jq '.'
    else
        log_error "Invalid JSON data provided to format_json"
        return 1
    fi
}

# ============================================================================
# Script Functions
# ============================================================================

usage() {
    cat << 'EOF' >&2
Usage: artifacts-list [options]

List and filter artifacts from GitHub Packages.

Required Options:
  --owner <org>         Repository owner/organization

Optional Filters:
  --type <type>         Package type (npm, nuget, docker, maven, rubygems, gradle, cargo)
  --name <pattern>      Package name filter (partial match, case-insensitive)
  --repo <repo>         Specific repository to query

Output Options:
  --format <format>     Output format: table (default), json
  --sort <field>        Sort by field: name (default), type, created_at, updated_at
  --versions            List versions for a package (requires --type and --name)

Other Options:
  --help                Show this help message

Examples:
  # List all npm packages
  artifacts-list --owner myorg --type npm

  # Filter by name pattern
  artifacts-list --owner myorg --type nuget --name "service"

  # List versions for a specific package
  artifacts-list --owner myorg --type npm --name my-package --versions

  # Output as JSON
  artifacts-list --owner myorg --format json

EOF
}

main() {
    local owner=""
    local type=""
    local name=""
    local format="table"
    local repo=""
    local sort_field="name"
    local list_versions=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --owner)
                owner="$2"
                shift 2
                ;;
            --type)
                type="$2"
                shift 2
                ;;
            --name)
                name="$2"
                shift 2
                ;;
            --format)
                format="$2"
                shift 2
                ;;
            --repo)
                repo="$2"
                shift 2
                ;;
            --sort)
                sort_field="$2"
                shift 2
                ;;
            --versions)
                list_versions=true
                shift
                ;;
            --help)
                usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                return 1
                ;;
        esac
    done

    # Use GH_ORG environment variable if owner not provided
    if [ -z "$owner" ]; then
        owner="${GH_ORG:-}"
    fi

    # Validate required arguments
    if [ -z "$owner" ]; then
        log_error "owner is required (use --owner or set GH_ORG environment variable)"
        usage
        return 1
    fi

    # Ensure GitHub CLI authentication
    ensure_gh_login || return 1

    # List package versions if requested
    if [ "$list_versions" = true ]; then
        if [ -z "$type" ] || [ -z "$name" ]; then
            log_error "--type and --name are required when using --versions"
            return 1
        fi

        log_info "Fetching versions for package: $name ($type)"
        
        local versions_json
        versions_json=$(get_package_versions --owner "$owner" --type "$type" --name "$name" ${repo:+--repo "$repo"}) || {
            log_error "Failed to get versions for $name"
            return 1
        }

        # Check if versions were found
        if [ -z "$(echo "$versions_json" | jq -r '.[]? // empty' 2>/dev/null)" ]; then
            log_error "No versions found for package: $name"
            return 1
        fi

        case "$format" in
            table)
                format_versions_table "$versions_json" --sort "$sort_field"
                ;;
            json)
                format_json "$versions_json"
                ;;
            *)
                log_error "Invalid format: $format (must be table or json)"
                return 1
                ;;
        esac

        return 0
    fi

    # List packages
    log_info "Fetching packages${type:+ of type: $type}${name:+ matching: $name}..."

    local packages_json
    packages_json=$(query_packages --owner "$owner" ${type:+--type "$type"} ${name:+--name "$name"} ${repo:+--repo "$repo"}) || {
        log_error "Failed to query packages"
        return 1
    }

    # Check if packages were found
    if [ -z "$(echo "$packages_json" | jq -r '.[]? // empty' 2>/dev/null)" ]; then
        log_info "No packages found matching the criteria"
        return 0
    fi

    # Output results in requested format
    case "$format" in
        table)
            local count
            count=$(echo "$packages_json" | jq 'length')
            log_info "Found $count package(s)"
            echo ""
            format_packages_table "$packages_json" --sort "$sort_field"
            ;;
        json)
            format_json "$packages_json"
            ;;
        *)
            log_error "Invalid format: $format (must be table or json)"
            return 1
            ;;
    esac
}

# Run main function
main "$@"
