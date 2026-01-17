#!/bin/bash
# issue-operations.bash - GitHub issue and PR operations library
# Version: 1.0.0
# Description: Centralized functions for GitHub issue and PR operations
# Requirements: Bash 4.0+, gh CLI
# Author: WorkInProgress.ai
# Last Modified: 2026-01-04

# Guard against multiple sourcing
if [ -n "${_ISSUE_OPERATIONS_LOADED:-}" ]; then
    return 0
fi
_ISSUE_OPERATIONS_LOADED=1

# Ensure error handling library is loaded
if [ -z "${_ERROR_HANDLING_LOADED:-}" ] && [ -f "${DEVENV_ROOT:-}/tools/lib/error-handling.bash" ]; then
    source "${DEVENV_ROOT:-}/tools/lib/error-handling.bash"
fi

# ============================================================================
# Issue Listing and Filtering
# ============================================================================

# Build filter arguments for gh issue list
# Usage: build_issue_filters [--state STATE] [--type TYPE] [--labels LABEL...] [--assignee USER] [--milestone NAME] [--limit NUM]
# Arguments:
#   --state STATE         Filter by state (open, closed, all) - default: open
#   --type TYPE           Filter by type (epic, story, bug)
#   --labels LABEL        Add label filter (can be multiple)
#   --assignee USER       Filter by assignee
#   --milestone NAME      Filter by milestone
#   --limit NUM           Limit results - default: 100
# Returns: Filter arguments as space-separated string
# Example:
#   filters=$(build_issue_filters --state closed --type bug --limit 50)
#   gh issue list ${filters}
build_issue_filters() {
    local filters=()
    local state="open"
    local type=""
    local labels=()
    local assignee=""
    local milestone=""
    local limit="100"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --state)
                state="$2"
                shift 2
                ;;
            --type)
                type="$2"
                shift 2
                ;;
            --labels)
                labels+=("$2")
                shift 2
                ;;
            --assignee)
                assignee="$2"
                shift 2
                ;;
            --milestone)
                milestone="$2"
                shift 2
                ;;
            --limit)
                limit="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    # State filter
    filters+=(--state "$state")

    # Type filter (via label)
    if [ -n "$type" ]; then
        case "$type" in
            epic|story|bug)
                filters+=(--label "type:$type")
                ;;
            *)
                log_error "Invalid issue type: $type (must be epic, story, or bug)"
                return 1
                ;;
        esac
    fi

    # Label filters
    for label in "${labels[@]}"; do
        filters+=(--label "$label")
    done

    # Assignee filter
    if [ -n "$assignee" ]; then
        filters+=(--assignee "$assignee")
    fi

    # Milestone filter
    if [ -n "$milestone" ]; then
        filters+=(--milestone "$milestone")
    fi

    # Limit
    filters+=(--limit "$limit")

    echo "${filters[@]}"
}

# List issues with formatting
# Usage: list_issues_formatted [--state STATE] [--type TYPE] [--format FORMAT] [--repo REPO]
# Arguments:
#   --state STATE         Filter by state (open, closed, all)
#   --type TYPE           Filter by type (epic, story, bug)
#   --format FORMAT       Output format (table, json, simple) - default: table
#   --repo REPO           Repository (owner/repo)
# Returns: Formatted list of issues
# Example:
#   list_issues_formatted --state closed --type bug --format simple
list_issues_formatted() {
    local state="open"
    local type=""
    local format="table"
    local repo=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --state)
                state="$2"
                shift 2
                ;;
            --type)
                type="$2"
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
            *)
                shift
                ;;
        esac
    done

    local gh_args=()
    
    # Add repository if specified
    if [ -n "$repo" ]; then
        gh_args+=("$repo")
    fi

    # Build filters
    local filter_str
    filter_str=$(build_issue_filters --state "$state" --type "$type") || return 1
    read -ra filter_args <<< "$filter_str"
    gh_args+=("${filter_args[@]}")

    # Set output format
    case "$format" in
        table)
            gh issue list "${gh_args[@]}"
            ;;
        json)
            # shellcheck disable=SC2054  # gh CLI uses comma-separated fields
            gh_args+=(--json number,title,state,labels,assignees,milestone,createdAt,updatedAt,url)
            gh issue list "${gh_args[@]}"
            ;;
        simple)
            # shellcheck disable=SC2054  # gh CLI uses comma-separated fields
            gh_args+=(--json number,title)
            gh issue list "${gh_args[@]}" | jq -r '.[] | "#\(.number) - \(.title)"'
            ;;
        *)
            log_error "Invalid format: $format (must be table, json, or simple)"
            return 1
            ;;
    esac
}

# Get issues as tab-separated for fzf selection
# Usage: get_issues_for_selection [--state STATE] [--type TYPE] [--labels LABEL...] [--repo REPO]
# Arguments:
#   --state STATE         Filter by state
#   --type TYPE           Filter by type
#   --labels LABEL        Add label filter (can be multiple)
#   --repo REPO           Repository (owner/repo)
# Returns: Tab-separated issue list (number, title, labels)
# Example:
#   issues=$(get_issues_for_selection --state closed)
#   echo "$issues" | fzf_select_single ...
get_issues_for_selection() {
    local state="open"
    local type=""
    local labels=()
    local repo=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --state)
                state="$2"
                shift 2
                ;;
            --type)
                type="$2"
                shift 2
                ;;
            --labels)
                labels+=("$2")
                shift 2
                ;;
            --repo)
                repo="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    local gh_args=(--limit 1000)
    # shellcheck disable=SC2054  # gh CLI uses comma-separated fields
    gh_args+=(--json number,title,labels,state,updatedAt)
    
    # Add repository if specified
    if [ -n "$repo" ]; then
        gh_args+=("$repo")
    fi

    # Add filters
    gh_args+=(--state "$state")
    
    if [ -n "$type" ]; then
        gh_args+=(--label "type:$type")
    fi
    
    for label in "${labels[@]}"; do
        gh_args+=(--label "$label")
    done

    # Get issues and format for fzf (tab-separated)
    gh issue list "${gh_args[@]}" | jq -r '.[] | 
        "#\(.number)\t\(.title)\t[\(.labels | map(.name) | join(", "))]"'
}

# ============================================================================
# Pull Request Operations
# ============================================================================

# Find PR by branch
# Usage: find_pr_by_branch [--repo REPO] [--state STATE] BRANCH_NAME
# Arguments:
#   --repo REPO           Repository (owner/repo)
#   --state STATE         PR state (open, closed, merged, all) - default: open
#   BRANCH_NAME           Git branch name
# Returns: PR URL if found, empty string if not found
# Example:
#   pr_url=$(find_pr_by_branch --repo myorg/myrepo feature/new-feature)
find_pr_by_branch() {
    local repo=""
    local state="open"
    local branch=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --repo)
                repo="$2"
                shift 2
                ;;
            --state)
                state="$2"
                shift 2
                ;;
            *)
                branch="$1"
                shift
                ;;
        esac
    done

    if [ -z "$branch" ]; then
        log_error "Branch name is required"
        return 1
    fi

    local gh_args=(--state "$state" --head "$branch" --json url --jq '.[0].url')
    [ -n "$repo" ] && gh_args+=("$repo")
    
    gh pr list "${gh_args[@]}" 2>/dev/null || echo ""
}

# Find PR by search criteria
# Usage: find_pr_by_search [--repo REPO] [--state STATE] SEARCH_QUERY
# Arguments:
#   --repo REPO           Repository (owner/repo)
#   --state STATE         PR state (open, closed, merged, all) - default: open
#   SEARCH_QUERY          Search string (e.g., "REVIEW:", "head:feature/")
# Returns: PR data as JSON
# Example:
#   pr=$(find_pr_by_search --repo myorg/myrepo "REVIEW:")
find_pr_by_search() {
    local repo=""
    local state="open"
    local search=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --repo)
                repo="$2"
                shift 2
                ;;
            --state)
                state="$2"
                shift 2
                ;;
            *)
                search="$1"
                shift
                ;;
        esac
    done

    if [ -z "$search" ]; then
        log_error "Search query is required"
        return 1
    fi

    local gh_args=(--state "$state" --search "$search")
    # shellcheck disable=SC2054  # gh CLI uses comma-separated fields
    gh_args+=(--json title,url,number)
    [ -n "$repo" ] && gh_args+=("$repo")
    
    gh pr list "${gh_args[@]}" 2>/dev/null || echo "[]"
}

# Create PR with options
# Usage: create_pr [--repo REPO] [--title TITLE] [--body BODY] [--draft] [--head BRANCH] [--base BRANCH]
# Arguments:
#   --repo REPO           Repository (owner/repo)
#   --title TITLE         PR title
#   --body BODY           PR description
#   --draft               Create as draft PR
#   --head BRANCH         Source branch
#   --base BRANCH         Target branch
# Returns: PR URL
# Example:
#   pr_url=$(create_pr --repo myorg/myrepo --title "New Feature" --head feature/new-feature)
create_pr() {
    local repo=""
    local title=""
    local body=""
    local draft=0
    local head=""
    local base=""
    local gh_args=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --repo)
                repo="$2"
                shift 2
                ;;
            --title)
                title="$2"
                shift 2
                ;;
            --body)
                body="$2"
                shift 2
                ;;
            --draft)
                draft=1
                shift
                ;;
            --head)
                head="$2"
                shift 2
                ;;
            --base)
                base="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    [ -n "$repo" ] && gh_args+=("$repo")
    [ -n "$title" ] && gh_args+=(--title "$title")
    [ -n "$body" ] && gh_args+=(--body "$body")
    [ "$draft" -eq 1 ] && gh_args+=(--draft)
    [ -n "$head" ] && gh_args+=(--head "$head")
    [ -n "$base" ] && gh_args+=(--base "$base")

    gh pr create "${gh_args[@]}" 2>/dev/null || return 1
}

# ============================================================================
# Issue State Operations
# ============================================================================

# Close issue(s)
# Usage: close_issue [--repo REPO] [--reason REASON] [--comment TEXT] ISSUE_NUMBER...
# Arguments:
#   --repo REPO           Repository (owner/repo)
#   --reason REASON       Close reason (completed or "not planned")
#   --comment TEXT        Comment to add
#   ISSUE_NUMBER          Issue number(s) to close
# Returns: Status
# Example:
#   close_issue --repo myorg/myrepo --reason completed 123 124
close_issue() {
    local repo=""
    local reason=""
    local comment=""
    local issue_numbers=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --repo)
                repo="$2"
                shift 2
                ;;
            --reason)
                reason="$2"
                shift 2
                ;;
            --comment)
                comment="$2"
                shift 2
                ;;
            *)
                issue_numbers+=("$1")
                shift
                ;;
        esac
    done

    if [ ${#issue_numbers[@]} -eq 0 ]; then
        log_error "At least one issue number is required"
        return 1
    fi

    for issue_num in "${issue_numbers[@]}"; do
        local gh_args=(--state closed)
        [ -n "$repo" ] && gh_args+=("$repo")
        [ -n "$reason" ] && gh_args+=(--reason "$reason")
        [ -n "$comment" ] && gh_args+=(--comment "$comment")
        
        gh issue close "$issue_num" "${gh_args[@]}" || return 1
    done
}

# Reopen issue(s)
# Usage: reopen_issue [--repo REPO] [--comment TEXT] ISSUE_NUMBER...
# Arguments:
#   --repo REPO           Repository (owner/repo)
#   --comment TEXT        Comment to add
#   ISSUE_NUMBER          Issue number(s) to reopen
# Returns: Status
# Example:
#   reopen_issue --repo myorg/myrepo --comment "Revisiting this" 123
reopen_issue() {
    local repo=""
    local comment=""
    local issue_numbers=()

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --repo)
                repo="$2"
                shift 2
                ;;
            --comment)
                comment="$2"
                shift 2
                ;;
            *)
                issue_numbers+=("$1")
                shift
                ;;
        esac
    done

    if [ ${#issue_numbers[@]} -eq 0 ]; then
        log_error "At least one issue number is required"
        return 1
    fi

    for issue_num in "${issue_numbers[@]}"; do
        local gh_args=(--state open)
        [ -n "$repo" ] && gh_args+=("$repo")
        [ -n "$comment" ] && gh_args+=(--comment "$comment")
        
        gh issue reopen "$issue_num" "${gh_args[@]}" || return 1
    done
}

# ============================================================================
# Issue Validation
# ============================================================================

# Validate issue number format
# Usage: validate_issue_number ISSUE_NUMBER
# Arguments:
#   ISSUE_NUMBER          Issue number to validate
# Returns: 0 if valid, 1 if invalid
# Example:
#   if validate_issue_number "123"; then echo "Valid"; fi
validate_issue_number() {
    local issue="$1"
    
    if [ -z "$issue" ]; then
        log_error "Issue number cannot be empty"
        return 1
    fi
    
    if ! [[ "$issue" =~ ^[0-9]+$ ]]; then
        log_error "Invalid issue number: $issue (must be numeric)"
        return 1
    fi
    
    return 0
}

# Check if issue exists
# Usage: issue_exists [--repo REPO] ISSUE_NUMBER
# Arguments:
#   --repo REPO           Repository (owner/repo)
#   ISSUE_NUMBER          Issue number to check
# Returns: 0 if exists, 1 if not
# Example:
#   if issue_exists --repo myorg/myrepo 123; then echo "Found"; fi
issue_exists() {
    local repo=""
    local issue=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --repo)
                repo="$2"
                shift 2
                ;;
            *)
                issue="$1"
                shift
                ;;
        esac
    done

    validate_issue_number "$issue" || return 1

    local gh_args=(--json number)
    [ -n "$repo" ] && gh_args+=("$repo")
    
    if gh issue view "$issue" "${gh_args[@]}" &>/dev/null; then
        return 0
    else
        return 1
    fi
}

# ============================================================================
# Issue Type Management (from issue-helper.bash)
# ============================================================================

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

# =========================================================================
# Issue Type GraphQL Operations
# =========================================================================

# Set GitHub native issue type on an existing issue
# Usage: set_issue_type ISSUE_NUMBER REPO_OWNER REPO_NAME TYPE_NAME
# Notes: Requires that TYPE_NAME exists in tools/config/issues-config.yml with an id
set_issue_type() {
    local issue_number="$1"
    local repo_owner="$2"
    local repo_name="$3"
    local type_name="$4"

    if [ -z "$issue_number" ] || [ -z "$repo_owner" ] || [ -z "$repo_name" ] || [ -z "$type_name" ]; then
        echo "ERROR: set_issue_type requires ISSUE_NUMBER REPO_OWNER REPO_NAME TYPE_NAME" >&2
        return 1
    fi

    # Dependencies
    if ! command -v gh >/dev/null 2>&1; then
        echo "ERROR: gh CLI is required" >&2
        return 1
    fi
    if ! command -v jq >/dev/null 2>&1; then
        echo "ERROR: jq is required" >&2
        return 1
    fi

    # Get the issue ID from issue number
    local issue_id
    issue_id=$(gh api graphql -f query='query { repository(owner: "'$repo_owner'", name: "'$repo_name'") { issue(number: '$issue_number') { id } } }' 2>/dev/null | jq -r '.data.repository.issue.id')

    if [ -z "$issue_id" ] || [ "$issue_id" = "null" ]; then
        echo "ERROR: Could not find issue #$issue_number" >&2
        return 1
    fi

    # Load type ID from config via issues-config library
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/issues-config.bash"
    local type_id
    type_id=$(get_issue_type_id "$type_name")

    if [ -z "$type_id" ] || [ "$type_id" = "null" ]; then
        # Non-fatal: if id missing, skip setting to avoid failure
        echo "WARN: Issue type '$type_name' has no configured ID; skipping type set" >&2
        return 0
    fi

    # Update the issue with the type
    local mutation
    mutation='mutation { updateIssue(input: {id: "'$issue_id'", issueTypeId: "'$type_id'"}) { issue { number issueType { name } } } }'

    local result
    result=$(gh api graphql -f query="$mutation" 2>/dev/null)

    if echo "$result" | jq -e '.data.updateIssue.issue.issueType' &>/dev/null; then
        return 0
    else
        echo "WARN: Could not set issue type via API" >&2
        return 0
    fi
}

# Export functions
export -f set_issue_type
export -f build_issue_filters
export -f list_issues_formatted
export -f get_issues_for_selection
export -f find_pr_by_branch
export -f find_pr_by_search
export -f create_pr
export -f close_issue
export -f reopen_issue
export -f validate_issue_number
export -f issue_exists
export -f load_issue_types_from_config
export -f build_type_menu
export -f get_type_label_from_choice
export -f get_all_type_labels
