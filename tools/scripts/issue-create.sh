#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# issue-create.sh - Create a new GitHub issue with labels, assignees, and project assignment
# Version: 1.1.0
# Description: Creates GitHub issues with GitHub native type field (Bug/Feature/Task),
#              milestones, assignees, and automatic project assignment
# Requirements: Bash 4.0+, gh CLI
# Author: WorkInProgress.ai
# Last Modified: 2026-01-01

set -euo pipefail
# shellcheck disable=SC2034  # VERBOSE is written here; read by log_verbose in error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/provider-loader.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/fzf-selection.bash"
source "$DEVENV_TOOLS/lib/issues-config.bash"
source "$DEVENV_TOOLS/lib/body-source.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

readonly SCRIPT_VERSION="1.1.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME

# ============================================================================
# Global Variables
# ============================================================================

ISSUE_TITLE=""
ISSUE_BODY=""
BODY_ARG_TEXT=""
BODY_ARG_FILE=""
ISSUE_TYPE=""
ISSUE_LABELS=()
ISSUE_ASSIGNEES=()
ISSUE_MILESTONE=""
ISSUE_PROJECT=""
PARENT_ISSUE=""
BLOCKED_BY_ISSUES=()
TEMPLATE_FILE=""
SELECT_TEMPLATE=0
USE_TEMPLATE=0  # Default to no template (opt in with --template or --select-template); --no-template accepted as a no-op for backward compatibility
USE_EDITOR=1    # Default to opening editor
ALLOW_DEVENV_REPO=0  # Prevent running against devenv repo by default
DRY_RUN=0
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
VERBOSE=0
TEMP_FILE=""
# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

Create a new GitHub issue with labels, assignees, and project assignment.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without creating issue

Optional Flags:
    --devenv                    Allow creating issues in devenv repo itself (safety override)
Optional:
    -t, --title TITLE           Issue title (required only with --no-interactive)
    -b, --body TEXT             Issue body/description
    -f, --body-file FILE        Read issue body from file (markdown; '-' reads
                                stdin; piped stdin with no flag is auto-read)
    --type TYPE                 Issue type: a type from issues-config.yml
    -l, --label LABEL           Add label (can be specified multiple times)
    -a, --assignee USER         Assign to user (can be specified multiple times)
    -m, --milestone NAME        Assign to milestone
    -p, --project NAME          Add to project (name or number)
    --parent ISSUE_NUM          Link to parent issue (for stories/bugs under epics)
    --blocked-by ISSUE_NUM      Mark as blocked by prerequisite issue (repeatable)
    --template FILE             Opt in to a specific template file (opens in editor; without it, no template is used)
    --select-template           Opt in to interactive template selection (fzf over .github/ISSUE_TEMPLATE/)
    --no-template               Accepted no-op — issues are created without a template by default
    --no-interactive            Skip the editor (requires --title; template body used as-is when a template is selected)

Environment Variables:
    DEVENV_REPO                 Repository in format owner/repo (default: current repo)

Examples:
    # Interactive mode: select template, edit in editor
    # (Title comes from template's "title:" field or first line)
    $SCRIPT_NAME

    # Interactive with specific template
    $SCRIPT_NAME --template .github/ISSUE_TEMPLATE/bug_report.md

    # Interactive with type and other metadata
    $SCRIPT_NAME --type Bug --label "priority:high" --assignee "john"

    # Create with specific title (overrides template title)
    $SCRIPT_NAME --title "Login button not working" --type Bug

    # Template without editor (automation - title required)
    $SCRIPT_NAME --title "OAuth2 Integration" --type Feature \\
        --template .github/ISSUE_TEMPLATE/feature_request.md --no-interactive

    # Create without template
    $SCRIPT_NAME --title "Quick bug" --type Bug --no-template \\
        --body "Something is broken"

    # Create story under an epic
    $SCRIPT_NAME --parent 123 --project "Q1 2026" --milestone "Sprint 5"

    # Create issue blocked by a prerequisite
    $SCRIPT_NAME --title "Add OAuth" --type Feature --blocked-by 42

    # Multiple prerequisites
    $SCRIPT_NAME --title "Deploy v2" --type Task --blocked-by 42 --blocked-by 55

EOF
    exit 0
}

# Cleanup temporary files on exit
cleanup() {
    if [ -n "$TEMP_FILE" ] && [ -f "$TEMP_FILE" ]; then
        rm -f "$TEMP_FILE"
        log_verbose "Cleaned up temp file: $TEMP_FILE"
    fi
}
trap cleanup EXIT

# Select issue type using fzf if not provided
select_issue_type() {
    if [ -n "$ISSUE_TYPE" ]; then
        # Type already provided via CLI
        return 0
    fi

    # Deterministic mode never prompts: --no-interactive is the automation
    # contract (title + type are required there), so a missing type is an
    # argument error, not an interactive question. fzf reads the terminal
    # directly, so a wrongly-launched picker blocks automation with no way
    # for the caller to answer it.
    if [ "$USE_EDITOR" -eq 0 ]; then
        log_error "Issue type is required when using --no-interactive (use --type)"
        return 1
    fi

    check_fzf_installed || {
        log_error "fzf is required for type selection but not installed"
        log_info "Provide type via --type flag or install fzf"
        return 1
    }
    
    log_info "Select issue type:"
    local selected
    selected=$(get_issue_types_array | tr ' ' '\n' | fzf --no-multi --height=10 --preview "echo 'Type: {}'") 
    
    if [ -z "$selected" ]; then
        log_error "No issue type selected"
        return 1
    fi
    
    ISSUE_TYPE="$selected"
    log_verbose "Selected type: $ISSUE_TYPE"
    return 0
}

# Find all available issue templates
find_templates() {
    local template_dir="$DEVENV_ROOT/.github/ISSUE_TEMPLATE"
    
    if [ ! -d "$template_dir" ]; then
        return 0
    fi
    
    find "$template_dir" -type f \( -name "*.md" -o -name "*.yml" -o -name "*.yaml" \) | sort
}

# Select template using fzf
select_template_with_fzf() {
    local templates
    templates=$(find_templates)
    
    if [ -z "$templates" ]; then
        log_warn "No templates found in .github/ISSUE_TEMPLATE/"
        return 1
    fi
    
    # Refuse to launch fzf without an interactive terminal — otherwise the
    # picker blocks forever on a read that can never be answered (AI
    # invocations, piped output, CI). Fail fast with guidance instead.
    if [ ! -t 0 ] || [ ! -t 2 ]; then
        log_error "--select-template requires an interactive terminal (no TTY detected)."
        log_info "Use --template FILE to pick a template directly, or drop the flag to create without a template."
        return 1
    fi
    
    # Use fzf-selection library
    check_fzf_installed || {
        log_error "fzf is required for template selection but not installed"
        log_info "Install fzf or use --template to specify a template directly"
        return 1
    }
    
    local preview_cmd='head -20 {}'
    local selected
    selected=$(fzf_select_single "$templates" "Select template: " "$preview_cmd")
    
    if ! fzf_validate_selection "$selected" "template"; then
        return 1
    fi
    
    echo "$selected"
}

# Load and prepare template
prepare_template() {
    local template="$1"
    
    if [ ! -f "$template" ]; then
        log_error "Template file not found: $template"
        return 1
    fi
    
    # Create temp file for editing
    TEMP_FILE=$(mktemp /tmp/gh-issue.XXXXXX.md)
    log_verbose "Created temp file: $TEMP_FILE"
    
    # Extract YAML frontmatter title if present
    local frontmatter_title=""
    if head -1 "$template" | grep -q "^---"; then
        # Template starts with frontmatter
        frontmatter_title=$(sed -n '/^---/,/^---/p' "$template" | grep "^title:" | sed 's/^title:[[:space:]]*//; s/['"'"'"]//g')
    fi
    
    # Use provided title, or frontmatter title, or empty
    local display_title="${ISSUE_TITLE:-$frontmatter_title}"
    
    # Strip frontmatter from template
    local template_body
    if head -1 "$template" | grep -q "^---"; then
        # Skip everything up to and including the closing ---
        template_body=$(sed '1,/^---$/d' "$template")
    else
        template_body=$(cat "$template")
    fi
    
    # Build content for editor
    if [ "$USE_EDITOR" -eq 1 ]; then
        # Interactive mode: show title and body for editing
        {
            echo "$display_title"
            echo "---"
            echo "$template_body"
        } > "$TEMP_FILE"
        
        log_verbose "Opening template in editor: ${EDITOR:-nano}"
        local editor="${EDITOR:-nano}"
        
        if ! "$editor" "$TEMP_FILE"; then
            log_error "Editor exited with error"
            return 1
        fi
        
        # Parse the edited content back
        # First line is title, content after --- is body
        if grep -q "^---$" "$TEMP_FILE"; then
            ISSUE_TITLE=$(head -1 "$TEMP_FILE")
            ISSUE_BODY=$(sed '1,/^---$/d' "$TEMP_FILE")
        else
            # No separator found, treat first line as title
            ISSUE_TITLE=$(head -1 "$TEMP_FILE")
            ISSUE_BODY=$(tail -n +2 "$TEMP_FILE")
        fi
    else
        # Non-interactive mode: use template body as-is
        ISSUE_BODY="$template_body"
        
        # Only set title from template if not provided via CLI
        if [ -z "$ISSUE_TITLE" ]; then
            ISSUE_TITLE="$display_title"
        fi
    fi
    
    log_verbose "Template loaded - Title: '$ISSUE_TITLE' (${#ISSUE_BODY} bytes of body)"
}

# Validate required dependencies
check_dependencies() {
    if ! provider_auth_status &> /dev/null; then
        log_error "Not authenticated with the active provider"
        log_info "Run: key-update-provider"
        exit "$EXIT_GENERAL_ERROR"
    fi
}

# Build label list - exclude type label since type is set via GraphQL mutation
# Prepend parent reference to body if specified
build_body() {
    local body=""
    local nl=$'\n'
    
    # Add parent reference if specified
    if [ -n "$PARENT_ISSUE" ]; then
        body="Part of #${PARENT_ISSUE}${nl}${nl}"
    fi

    # Add blocked-by references if specified
    if [ ${#BLOCKED_BY_ISSUES[@]} -gt 0 ]; then
        for blocker in "${BLOCKED_BY_ISSUES[@]}"; do
            body+="Blocked by #${blocker}${nl}"
        done
        body+="$nl"
    fi

    # Add main body content. printf '%s', never echo -e: the body is the
    # user's text, and echo -e would turn their backslash sequences (a Windows
    # path, a regex, a literal \n) into control characters.
    body+="$ISSUE_BODY"
    
    printf '%s' "$body"
}

# Fail fast on a wrong or unreachable target: the repo the create will use
# (get_repo_spec resolution) must exist on the provider, or the user answers prompts
# for a run that cannot succeed. An empty spec (nothing resolvable) is not probed.
probe_target_repo() {
    local probe_repo
    probe_repo="$(get_repo_spec)"
    [ -n "$probe_repo" ] || return 0
    if ! provider_repos_view "$probe_repo" --json name -q .name >/dev/null 2>&1; then
        log_error "Target repository not found or inaccessible: $probe_repo"
        log_info "Check the DEVENV_REPO value and your provider access"
        exit "$EXIT_GENERAL_ERROR"
    fi
}

# Create the issue
create_issue() {
    local gh_args=()
    
    # Required: title
    gh_args+=(--title "$ISSUE_TITLE")
    
    # Validate type is set (will be applied after creation via GraphQL)
    if [ -z "$ISSUE_TYPE" ]; then
        log_error "Issue type is required"
        return 1
    fi
    
    # Body (always include, even if empty, as gh requires it)
    local final_body
    final_body=$(build_body)
    gh_args+=(--body "$final_body")
    
    # Optional: labels (one argument each: a label may contain spaces)
    local label
    for label in "${ISSUE_LABELS[@]}"; do
        gh_args+=(--label "$label")
    done
    
    # Optional: assignees
    for assignee in "${ISSUE_ASSIGNEES[@]}"; do
        gh_args+=(--assignee "$assignee")
    done
    
    # Optional: milestone
    if [ -n "$ISSUE_MILESTONE" ]; then
        gh_args+=(--milestone "$ISSUE_MILESTONE")
    fi
    
    log_verbose "Creating issue with args: ${gh_args[*]}"
    
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"
    
    if [ "$DRY_RUN" -eq 1 ]; then
        log_info "[DRY RUN] Would create issue via provider_issues_create:"
        echo "provider_issues_create ${repo_spec[0]:-} ${gh_args[*]}"
        return 0
    fi
    
    # Create the issue and capture the URL
    local issue_url
    issue_url=$(provider_issues_create "${repo_spec[0]:-}" "${gh_args[@]}")
    
    if [ -z "$issue_url" ]; then
        log_error "Failed to create issue"
        return 1
    fi
    
    log_info "Created issue: $issue_url"
    
    # The creation result is an issue URL or a bare id, depending on the provider
    local issue_number
    if ! issue_number=$(issue_number_from_ref "$issue_url"); then
        log_error "Issue created, but its number could not be read from the provider's answer: $issue_url"
        return 1
    fi
    
    # Set the issue type via GraphQL (organization-level issue types)
    # Repo identity comes from the same repo_spec the create used — never
    # re-derived from the cwd: with DEVENV_REPO set, an empty repo arg on the
    # provider call resolves to the CURRENT repo and would target the type
    # mutation at the wrong repository (the create and the type-set would
    # disagree silently).
    local repo_owner
    repo_owner=$(provider_repos_view "${repo_spec[0]:-}" --json owner -q .owner.login)
    local repo_name
    repo_name=$(provider_repos_view "${repo_spec[0]:-}" --json name -q .name)
    
    # Any requested enrichment that fails to apply is reported loudly and
    # fails the command: callers must be able to detect that a requested
    # attribute was dropped. The issue URL is still printed to stdout so
    # callers can parse it either way.
    local enrich_failed=0
    
    if [ -n "$ISSUE_TYPE" ] && ! set_issue_type "$issue_number" "$repo_owner" "$repo_name" "$ISSUE_TYPE"; then
        log_error "Issue created but type could not be set"
        log_error "Remediation: issue-update ${issue_number} --type ${ISSUE_TYPE}"
        enrich_failed=1
    fi
    
    # Add to project if specified
    if [ -n "$ISSUE_PROJECT" ]; then
        log_verbose "Adding issue #$issue_number to project: $ISSUE_PROJECT"
        
        local owner
        owner=$(provider_org_get 2>/dev/null) || owner="$repo_owner"
        
        # Resolve project name to number if not already a number
        local project_number="$ISSUE_PROJECT"
        if ! [[ "$project_number" =~ ^[0-9]+$ ]]; then
            project_number=$(provider_projects_list "" --owner "$owner" --format json --jq ".projects[] | select(.title == \"$ISSUE_PROJECT\") | .number" 2>/dev/null | head -1)
            if [ -z "$project_number" ]; then
                log_error "Issue created but could not be added to project: project '$ISSUE_PROJECT' not found"
                log_error "Remediation: verify the project name, then add the issue manually"
                enrich_failed=1
            else
                log_verbose "Resolved project '$ISSUE_PROJECT' to number $project_number"
            fi
        fi
        
        if [ -n "$project_number" ] && provider_projects_item_add "" "$project_number" "$issue_url" --owner "$owner" &> /dev/null; then
            log_info "Added to project: $ISSUE_PROJECT"
        elif [ -n "$project_number" ]; then
            log_error "Issue created but could not be added to project: $ISSUE_PROJECT (project may not exist or you may lack permissions)"
            log_error "Remediation: verify project name and permissions, then add the issue manually"
            enrich_failed=1
        fi
    fi

    # Workflow integration: native sub-issue link + parent recompute +
    # birth-status write. All best-effort; failures never block creation.
    local issue_num="$issue_number"
    local wf_lib
    wf_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/workflow-core.bash"
    if [ -f "$wf_lib" ]; then
        # shellcheck source=../lib/workflow-core.bash
        source "$wf_lib"
        if [ -n "$PARENT_ISSUE" ]; then
            issue_link_subissue "$PARENT_ISSUE" "$issue_num" 2>/dev/null \
                && log_verbose "Linked sub-issue #$issue_num -> #$PARENT_ISSUE"
            workflow_recompute_parent "$issue_num" 2>/dev/null
        fi
        # Birth rule: a Task under a parent is born Ready (its planning is
        # part of implementation); standalone issues start at TBD.
        if [ "$ISSUE_TYPE" = "Task" ] && [ -n "$PARENT_ISSUE" ]; then
            workflow_apply_status "$issue_num" "Ready" child 2>/dev/null
        else
            workflow_apply_status "$issue_num" "TBD" child 2>/dev/null
        fi
    fi
    
    echo "$issue_url"
    return "$enrich_failed"
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    # Global flags before auth/validation: --help / --version must work without
    # a valid provider session or any positional args.
    if handle_global_flag "${1:-}"; then
        exit 0
    fi

    ensure_provider_auth
    
    # Parse command-line arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                show_usage
                ;;
            -v|--version)
                echo "$SCRIPT_VERSION"
                exit 0
                ;;
            -V|--verbose)
                # shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
                VERBOSE=1
                shift
                ;;
            -n|--dry-run)
                DRY_RUN=1
                shift
                ;;
            -t|--title)
                require_option_value "$1" "${2:-}"
                ISSUE_TITLE="$2"
                shift 2
                ;;
            -b|--body)
                require_option_value "$1" "${2:-}"
                BODY_ARG_TEXT="$2"
                shift 2
                ;;
            -f|--body-file)
                require_option_value "$1" "${2:-}"
                BODY_ARG_FILE="$2"
                shift 2
                ;;
            --type)
                require_option_value "$1" "${2:-}"
                ISSUE_TYPE="$2"
                shift 2
                ;;
            -l|--label)
                require_option_value "$1" "${2:-}"
                ISSUE_LABELS+=("$2")
                shift 2
                ;;
            -a|--assignee)
                require_option_value "$1" "${2:-}"
                ISSUE_ASSIGNEES+=("$2")
                shift 2
                ;;
            -m|--milestone)
                require_option_value "$1" "${2:-}"
                ISSUE_MILESTONE="$2"
                shift 2
                ;;
            -p|--project)
                require_option_value "$1" "${2:-}"
                ISSUE_PROJECT="$2"
                shift 2
                ;;
            --parent)
                require_option_value "$1" "${2:-}"
                PARENT_ISSUE="$2"
                shift 2
                ;;
            --blocked-by)
                require_option_value "$1" "${2:-}"
                BLOCKED_BY_ISSUES+=("$2")
                shift 2
                ;;
            --template)
                require_option_value "$1" "${2:-}"
                TEMPLATE_FILE="$2"
                USE_TEMPLATE=1
                shift 2
                ;;
            --select-template)
                # Interactive template selection (fzf) — opt in to picking from
                # .github/ISSUE_TEMPLATE/ when you want a template but not a fixed one.
                USE_TEMPLATE=1
                SELECT_TEMPLATE=1
                shift
                ;;
            --no-template)
                # Backward-compatible no-op: templates are now opt-in (--template). Kept so
                # existing scripted calls and skill documentation keep working.
                USE_TEMPLATE=0
                shift
                ;;
            --no-interactive)
                USE_EDITOR=0
                shift
                ;;
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
                ALLOW_DEVENV_REPO=1
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit $EXIT_MISUSE
                ;;
        esac
    done

    # --body / --body-file go through the shared body-source resolver (one
    # implementation of "which source wins and what is an error" for every tool
    # that ingests markdown); a usage error from it exits 2 like any other.
    if [ -n "$BODY_ARG_TEXT" ] || [ -n "$BODY_ARG_FILE" ]; then
        if [ "$BODY_ARG_FILE" = "-" ] && body_source_stdin_is_tty; then
            log_error "--body-file - requires piped stdin (refusing to read the terminal)"
            exit "$EXIT_MISUSE"
        fi
        ISSUE_BODY=$(body_source_resolve "$BODY_ARG_TEXT" "$BODY_ARG_FILE") || exit "$EXIT_MISUSE"
    fi
    
    # Validate required arguments
    # Title is required only if using --no-interactive mode
    # In interactive mode, title can come from template
    if [ "$USE_EDITOR" -eq 0 ] && [ -z "$ISSUE_TITLE" ]; then
        log_error "Issue title is required when using --no-interactive (use --title)"
        exit $EXIT_MISUSE
    fi
    
    # Check dependencies
    check_dependencies
    
    # Validate target repository
    check_target_repo

    # Fail fast on a wrong or unreachable target BEFORE any interactive prompt.
    probe_target_repo

    # Select and validate issue type (required)
    if ! select_issue_type; then
        log_error "Issue type selection failed"
        exit $EXIT_MISUSE
    fi
    
    # Use library function to validate (validate_issue_type is from issues-config.bash)
    local config_path
    config_path=$(load_issues_config) || exit "$EXIT_GENERAL_ERROR"
    
    if ! validate_issue_type "$ISSUE_TYPE" "$config_path"; then
        log_info "Valid types: $(get_issue_types_array)"
        exit "$EXIT_GENERAL_ERROR"
    fi
    
    # Piped stdin capture (shared body-source contract): capture BEFORE any
    # template/editor work so a piped body is never silently dropped or eaten
    # by the editor. Precedence is --body/--body-file > template > stdin: the
    # captured value is used only when nothing else produced a body. Empty
    # stdin is NOT an error here — an interactive template session legitimately
    # has no pipe — so capture into a holding var and validate at use time.
    PIPED_STDIN_BODY=""
    if [ -z "$ISSUE_BODY" ] && ! body_source_stdin_is_tty; then
        local stdin_probe
        if stdin_probe=$(body_source_capture_stdin); then
            PIPED_STDIN_BODY="$stdin_probe"
            log_verbose "Piped stdin captured as body candidate"
        fi
    fi

    # Handle template workflow
    if [ "$USE_TEMPLATE" -eq 1 ]; then
        local template_to_use
        
        # Determine which template to use
        if [ -n "$TEMPLATE_FILE" ]; then
            # Explicit template specified
            template_to_use="$TEMPLATE_FILE"
        elif [ "$SELECT_TEMPLATE" -eq 1 ]; then
            # Interactive selection from available templates (fzf)
            template_to_use=$(select_template_with_fzf)
            if [ -z "$template_to_use" ]; then
                # User cancelled or no templates available
                USE_TEMPLATE=0
            fi
        else
            # Let user select with fzf (or show error if no templates/fzf)
            template_to_use=$(select_template_with_fzf)
            if [ -z "$template_to_use" ]; then
                # User cancelled or no templates available
                # Continue without template
                USE_TEMPLATE=0
            fi
        fi
        
        # Load and prepare the template (copy to temp, optionally edit)
        if [ -n "$template_to_use" ] && [ "$USE_TEMPLATE" -eq 1 ]; then
            prepare_template "$template_to_use"
        fi
    else
        log_verbose "Template usage disabled (--no-template)"
    fi

    # Body precedence: --body/--body-file > template/editor > piped stdin.
    # The captured stdin body is used only when nothing else produced one;
    # an empty captured body is a hard error (silence hides caller bugs).
    if [ -z "$ISSUE_BODY" ] && [ -n "$PIPED_STDIN_BODY" ]; then
        if [ -z "$(printf '%s' "$PIPED_STDIN_BODY" | tr -d '[:space:]')" ]; then
            log_error "Refusing empty piped stdin body"
            echo "Use --help for usage information"
            exit $EXIT_MISUSE
        fi
        ISSUE_BODY="$PIPED_STDIN_BODY"
        log_verbose "No body flag and no template body; issue body from piped stdin"
    fi

    # Create the issue
    create_issue
}

# Run main function
main "$@"
