#!/bin/bash
# issue-create.sh - Create a new GitHub issue with labels, assignees, and project assignment
# Version: 1.0.0
# Description: Creates GitHub issues with support for type labels (epic/story/bug),
#              milestones, assignees, and automatic project assignment
# Requirements: Bash 4.0+, gh CLI
# Author: WorkInProgress.ai
# Last Modified: 2026-01-01

set -euo pipefail

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME
# Source required libraries
if [ -f "$DEVENV_ROOT/tools/lib/error-handling.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/error-handling.bash"
fi

if [ -f "$DEVENV_ROOT/tools/lib/versioning.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/versioning.bash"
    script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Create GitHub issues"
fi

if [ -f "$DEVENV_ROOT/tools/lib/github-helpers.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/github-helpers.bash"
fi

if [ -f "$DEVENV_ROOT/tools/lib/git-config.bash" ]; then
    source "$DEVENV_ROOT/tools/lib/git-config.bash"
fi

# ============================================================================
# Global Variables
# ============================================================================

ISSUE_TITLE=""
ISSUE_BODY=""
ISSUE_TYPE=""
ISSUE_LABELS=()
ISSUE_ASSIGNEES=()
ISSUE_MILESTONE=""
ISSUE_PROJECT=""
PARENT_ISSUE=""
TEMPLATE_FILE=""
USE_TEMPLATE=1  # Default to using templates
USE_EDITOR=1    # Default to opening editor
ALLOW_DEVENV_REPO=0  # Prevent running against devenv repo by default
DRY_RUN=0
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
    -f, --body-file FILE        Read issue body from file (markdown)
    --type TYPE                 Issue type: epic, story, or bug (adds type:TYPE label)
    -l, --label LABEL           Add label (can be specified multiple times)
    -a, --assignee USER         Assign to user (can be specified multiple times)
    -m, --milestone NAME        Assign to milestone
    -p, --project NAME          Add to project (name or number)
    --parent ISSUE_NUM          Link to parent issue (for stories/bugs under epics)
    --template FILE             Use specific template file (opens in editor)
    --no-template               Skip template selection and don't use any template
    --no-interactive            Use template without opening editor (requires --template)

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)

Examples:
    # Interactive mode: select template, edit in editor
    # (Title comes from template's "title:" field or first line)
    $SCRIPT_NAME

    # Interactive with specific template
    $SCRIPT_NAME --template .github/ISSUE_TEMPLATE/bug_report.md

    # Interactive with type and other metadata
    $SCRIPT_NAME --type bug --label "priority:high" --assignee "john"

    # Create with specific title (overrides template title)
    $SCRIPT_NAME --title "Login button not working" --type bug

    # Template without editor (automation - title required)
    $SCRIPT_NAME --title "OAuth2 Integration" --type story \\
        --template .github/ISSUE_TEMPLATE/story_template.md --no-interactive

    # Create without template
    $SCRIPT_NAME --title "Quick bug" --type bug --no-template \\
        --body "Something is broken"

    # Create story under an epic
    $SCRIPT_NAME --parent 123 --project "Q1 2026" --milestone "Sprint 5"

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

# Cleanup temporary files on exit
cleanup() {
    if [ -n "$TEMP_FILE" ] && [ -f "$TEMP_FILE" ]; then
        rm -f "$TEMP_FILE"
        log_verbose "Cleaned up temp file: $TEMP_FILE"
    fi
}
trap cleanup EXIT

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
    
    if ! command -v fzf &> /dev/null; then
        log_error "fzf is required for template selection but not installed"
        log_info "Install fzf or use --template to specify a template directly"
        return 1
    fi
    
    local selected
    selected=$(echo "$templates" | fzf --preview 'head -20 {}' --preview-window=right:50% --height=50%)
    
    if [ -z "$selected" ]; then
        log_info "No template selected"
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
    if ! command -v gh &> /dev/null; then
        log_error "GitHub CLI (gh) is not installed or not in PATH"
        log_info "Install from: https://cli.github.com/"
        exit 1
    fi

    if ! gh auth status &> /dev/null; then
        log_error "Not authenticated with GitHub CLI"
        log_info "Run: gh auth login"
        exit 1
    fi
}

# Build label list including type label if specified
build_labels() {
    local labels=()
    
    # Add type label if specified
    if [ -n "$ISSUE_TYPE" ]; then
        case "$ISSUE_TYPE" in
            epic|story|bug)
                labels+=("type:$ISSUE_TYPE")
                ;;
            *)
                log_error "Invalid issue type: $ISSUE_TYPE (must be epic, story, or bug)"
                exit 1
                ;;
        esac
    fi
    
    # Add additional labels
    for label in "${ISSUE_LABELS[@]}"; do
        labels+=("$label")
    done
    
    # Return comma-separated list
    IFS=,
    echo "${labels[*]}"
}

# Prepend parent reference to body if specified
build_body() {
    local body=""
    
    # Add parent reference if specified
    if [ -n "$PARENT_ISSUE" ]; then
        body="Part of #${PARENT_ISSUE}\n\n"
    fi
    
    # Add main body content
    body+="$ISSUE_BODY"
    
    echo -e "$body"
}

# Create the issue
create_issue() {
    local gh_args=()
    
    # Required: title
    gh_args+=(--title "$ISSUE_TITLE")
    
    # Body (always include, even if empty, as gh requires it)
    local final_body
    final_body=$(build_body)
    gh_args+=(--body "$final_body")
    
    # Optional: labels
    local labels
    labels=$(build_labels)
    if [ -n "$labels" ]; then
        IFS=',' read -ra label_array <<< "$labels"
        for label in "${label_array[@]}"; do
            gh_args+=(--label "$label")
        done
    fi
    
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
        log_info "[DRY RUN] Would create issue with command:"
        echo "gh issue create ${repo_spec[*]} ${gh_args[*]}"
        return 0
    fi
    
    # Create the issue and capture the URL
    local issue_url
    issue_url=$(gh issue create "${repo_spec[@]}" "${gh_args[@]}")
    
    if [ -z "$issue_url" ]; then
        log_error "Failed to create issue"
        return 1
    fi
    
    log_info "Created issue: $issue_url"
    
    # Extract issue number from URL
    local issue_number
    issue_number=$(echo "$issue_url" | grep -oP '/issues/\K\d+')
    
    # Add to project if specified
    if [ -n "$ISSUE_PROJECT" ]; then
        log_verbose "Adding issue #$issue_number to project: $ISSUE_PROJECT"
        
        local owner
        if [ -n "${GITHUB_ORG:-}" ]; then
            owner="$GITHUB_ORG"
        else
            owner=$(gh repo view "${repo_spec[@]}" --json owner -q .owner.login)
        fi
        
        if gh project item-add "$ISSUE_PROJECT" --owner "$owner" --url "$issue_url" &> /dev/null; then
            log_info "Added to project: $ISSUE_PROJECT"
        else
            log_warn "Could not add to project: $ISSUE_PROJECT (project may not exist or you may lack permissions)"
        fi
    fi
    
    echo "$issue_url"
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
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
            *)
                break
                ;;
        esac
    done
    
    # Ensure GitHub CLI authentication
    ensure_gh_login
    
    # Continue parsing other arguments
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
                VERBOSE=1
                shift
                ;;
            -n|--dry-run)
                DRY_RUN=1
                shift
                ;;
            -t|--title)
                ISSUE_TITLE="$2"
                shift 2
                ;;
            -b|--body)
                ISSUE_BODY="$2"
                shift 2
                ;;
            -f|--body-file)
                if [ ! -f "$2" ]; then
                    log_error "Body file not found: $2"
                    exit 1
                fi
                ISSUE_BODY=$(cat "$2")
                shift 2
                ;;
            --type)
                ISSUE_TYPE="$2"
                shift 2
                ;;
            -l|--label)
                ISSUE_LABELS+=("$2")
                shift 2
                ;;
            -a|--assignee)
                ISSUE_ASSIGNEES+=("$2")
                shift 2
                ;;
            -m|--milestone)
                ISSUE_MILESTONE="$2"
                shift 2
                ;;
            -p|--project)
                ISSUE_PROJECT="$2"
                shift 2
                ;;
            --parent)
                PARENT_ISSUE="$2"
                shift 2
                ;;
            --template)
                TEMPLATE_FILE="$2"
                USE_TEMPLATE=1
                shift 2
                ;;
            --no-template)
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
                exit 1
                ;;
        esac
    done
    
    # Validate required arguments
    # Title is required only if using --no-interactive mode
    # In interactive mode, title can come from template
    if [ "$USE_EDITOR" -eq 0 ] && [ -z "$ISSUE_TITLE" ]; then
        log_error "Issue title is required when using --no-interactive (use --title)"
        exit 1
    fi
    
    # Check dependencies
    check_dependencies
    
    # Validate target repository
    check_target_repo
    
    # Handle template workflow
    if [ "$USE_TEMPLATE" -eq 1 ]; then
        local template_to_use
        
        # Determine which template to use
        if [ -n "$TEMPLATE_FILE" ]; then
            # Explicit template specified
            template_to_use="$TEMPLATE_FILE"
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
    
    # Create the issue
    create_issue
}

# Run main function
main "$@"
