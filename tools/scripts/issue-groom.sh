#!/bin/bash
# issue-groom.sh - Interactive issue grooming and workflow management
# Version: 1.0.0
# Description: Interactive wizard for grooming issues through TBD → To Groom → Ready workflow
# Requirements: Bash 4.0+, gh CLI, fzf
# Author: WorkInProgress.ai
# Last Modified: 2026-01-01

set -euo pipefail
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/versioning.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/git-operations.bash"
source "$DEVENV_TOOLS/lib/config-reader.bash"
source "$DEVENV_TOOLS/lib/issue-operations.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME

# ============================================================================
# Global Variables
# ============================================================================

PROJECT_NAME=""
MILESTONE=""
VERBOSE=0
ALLOW_DEVENV_REPO=0
ISSUE_TYPES=()

# Initialize issue types from config
initialize_issue_types() {
    load_issue_types_from_config "$DEVENV_TOOLS/config/issues-config.yml"
}

# Workflow states
# shellcheck disable=SC2034 # Used for documentation and potential future use
readonly STATUS_TBD="TBD"
# shellcheck disable=SC2034
readonly STATUS_TO_GROOM="To Groom"
# shellcheck disable=SC2034
readonly STATUS_READY="Ready"

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS]

Interactive issue grooming wizard to manage backlog and prepare issues for sprints.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output

    -p, --project NAME          Filter by project
    -m, --milestone NAME        Filter by milestone
    --devenv                    Safety override to groom issues in devenv repo

Workflow:
    TBD         → Issue needs refinement before grooming
    To Groom    → Ready for grooming session
    Ready       → Fully groomed, ready for sprint planning

Grooming Actions:
    - Review issue details
    - Add/update description and acceptance criteria
    - Add type label (epic/story/bug)
    - Set milestone (sprint assignment)
    - Add assignee
    - Add priority and other labels
    - Mark as "Ready" when grooming is complete
    - Skip or defer issues not ready for grooming

Environment Variables:
    GITHUB_REPO                 Repository in format owner/repo (default: current repo)

Examples:
    # Start grooming session for all "To Groom" issues
    $SCRIPT_NAME

    # Groom issues in specific project
    $SCRIPT_NAME --project "Q1 2026"

    # Groom issues for specific sprint
    $SCRIPT_NAME --milestone "Sprint 5"

EOF
    exit 0
}

log_verbose() {
    if [ "$VERBOSE" -eq 1 ]; then
        log_info "$@"
    fi
}

# Get issues that need grooming - uses library function
get_grooming_issues() {
    log_info "Fetching issues for grooming..."
    # Use library function to list issues, filtered for open state
    list_issues_formatted "open" "" "" ""
}

# Display issue details
show_issue_details() {
    local issue_num="$1"
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"
    
    clear
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Issue #$issue_num Details"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    gh issue view "${repo_spec[@]}" "$issue_num"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Interactive grooming menu
groom_issue() {
    local issue_num="$1"
    
    while true; do
        show_issue_details "$issue_num"
        
        echo ""
        echo "Grooming Actions:"
        echo "  1) Set type (epic/story/bug)"
        echo "  2) Edit title"
        echo "  3) Edit description"
        echo "  4) Set milestone (sprint)"
        echo "  5) Add assignee"
        echo "  6) Add labels"
        echo "  7) Link to parent (for stories/bugs)"
        echo "  8) Mark as Ready ✓"
        echo "  9) Mark for later grooming (To Groom)"
        echo "  s) Skip this issue"
        echo "  o) Open in browser"
        echo "  q) Quit grooming session"
        echo ""
        local repo_spec
        read -ra repo_spec <<< "$(get_repo_spec)"
        read -rp "Action [1-9/s/o/q]: " action
        
        case "$action" in
            1)
                set_issue_type "$issue_num"
                ;;
            2)
                read -rp "New title: " new_title
                if [ -n "$new_title" ]; then
                    gh issue edit "${repo_spec[@]}" "$issue_num" --title "$new_title"
                    log_info "Updated title"
                fi
                ;;
            3)
                # Open editor for body
                local tmpfile
                tmpfile=$(mktemp)
                gh issue view "${repo_spec[@]}" "$issue_num" --json body -q .body > "$tmpfile"
                "${EDITOR:-nano}" "$tmpfile"
                gh issue edit "${repo_spec[@]}" "$issue_num" --body-file "$tmpfile"
                rm "$tmpfile"
                log_info "Updated description"
                ;;
            4)
                set_milestone "$issue_num"
                ;;
            5)
                read -rp "Assignee username: " assignee
                if [ -n "$assignee" ]; then
                    gh issue edit "${repo_spec[@]}" "$issue_num" --add-assignee "$assignee"
                    log_info "Added assignee: $assignee"
                fi
                ;;
            6)
                read -rp "Label to add: " label
                if [ -n "$label" ]; then
                    gh issue edit "${repo_spec[@]}" "$issue_num" --add-label "$label"
                    log_info "Added label: $label"
                fi
                ;;
            7)
                read -rp "Parent issue number: " parent
                if [[ "$parent" =~ ^[0-9]+$ ]]; then
                    local current_body
                    current_body=$(gh issue view "${repo_spec[@]}" "$issue_num" --json body -q .body)
                    local new_body="Part of #${parent}\n\n${current_body}"
                    echo -e "$new_body" | gh issue edit "${repo_spec[@]}" "$issue_num" --body-file -
                    log_info "Linked to parent #$parent"
                fi
                ;;
            8)
                # Mark as Ready
                log_info "Marking issue #$issue_num as Ready"
                log_info "Note: Set Status=Ready in project manually or via GraphQL"
                gh issue edit "${repo_spec[@]}" "$issue_num" --remove-label "needs-grooming" 2>/dev/null || true
                gh issue edit "${repo_spec[@]}" "$issue_num" --add-label "status:ready"
                return 0
                ;;
            9)
                # Mark for grooming
                gh issue edit "${repo_spec[@]}" "$issue_num" --add-label "needs-grooming"
                log_info "Marked for grooming"
                return 0
                ;;
            s)
                # Skip
                log_info "Skipped issue #$issue_num"
                return 0
                ;;
            o)
                # Open in browser
                gh issue view "${repo_spec[@]}" "$issue_num" --web
                ;;
            q)
                # Quit
                log_info "Grooming session ended"
                exit 0
                ;;
            *)
                echo "Invalid option"
                sleep 1
                ;;
        esac
    done
}

# Set issue type
set_issue_type() {
    local issue_num="$1"
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"
    
    echo ""
    echo "Select issue type:"
    build_type_menu
    echo ""
    read -rp "Type [1-${#ISSUE_TYPES[@]}]: " type_choice
    
    local type_label
    type_label=$(get_type_label_from_choice "$type_choice")
    if [ -z "$type_label" ]; then
        echo "Invalid choice"
        return 1
    fi
    
    # Remove all existing type labels
    local all_labels
    all_labels=$(get_all_type_labels)
    for label in $all_labels; do
        gh issue edit "${repo_spec[@]}" "$issue_num" --remove-label "$label" 2>/dev/null || true
    done
    
    # Add new type label
    gh issue edit "${repo_spec[@]}" "$issue_num" --add-label "$type_label"
    log_info "Set type to: $type_label"
}

# Set milestone
set_milestone() {
    local issue_num="$1"
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"
    
    # Determine owner and repo
    local owner repo
    if [ -n "${GH_ORG:-}" ]; then
        owner="$GH_ORG"
        repo=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "")
    else
        owner=$(git remote get-url origin 2>/dev/null | sed -E 's|.*[:/]([^/]+)/([^/]+)\.git|\1|')
        repo=$(git remote get-url origin 2>/dev/null | sed -E 's|.*[:/]([^/]+)/([^/]+)\.git|\2|')
    fi
    
    # List available milestones
    echo ""
    echo "Available milestones:"
    gh api "repos/${owner}/${repo}/milestones" --jq '.[] | "\(.number)) \(.title) (due: \(.due_on // "no date"))"'
    echo ""
    read -rp "Milestone title or number: " milestone_choice
    
    if [ -n "$milestone_choice" ]; then
        gh issue edit "${repo_spec[@]}" "$issue_num" --milestone "$milestone_choice"
        log_info "Set milestone to: $milestone_choice"
    fi
}

# Run grooming session
run_grooming_session() {
    local issues
    issues=$(get_grooming_issues)
    
    if [ -z "$issues" ]; then
        log_info "No issues found for grooming"
        return 0
    fi
    
    local issue_count
    issue_count=$(echo "$issues" | wc -l)
    
    log_info "Found $issue_count issue(s) for grooming"
    echo ""
    
    # Process each issue
    echo "$issues" | while read -r issue_line; do
        local issue_num
        issue_num=$(echo "$issue_line" | grep -oP '#\K\d+')
        
        groom_issue "$issue_num"
    done
    
    log_info "Grooming session complete!"
}

# ============================================================================
# Main Script Logic
# ============================================================================

main() {
    # Initialize issue types from config
    initialize_issue_types
    
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
            -p|--project)
                # shellcheck disable=SC2034  # May be used in future feature
                PROJECT_NAME="$2"
                shift 2
                ;;
            -m|--milestone)
                # shellcheck disable=SC2034  # May be used in future feature
                MILESTONE="$2"
                shift 2
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
    
    # Check dependencies
    check_dependencies
    
    # Validate target repo
    check_target_repo
    
    # Welcome message
    clear
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "           GitHub Issue Grooming Wizard"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    log_info "Starting grooming session..."
    echo ""
    sleep 1
    
    # Run grooming session
    run_grooming_session
}

# Run main function
main "$@"
