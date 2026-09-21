#!/bin/bash
# Resolve the tools root from this script's own location (self-root
# contract: self-location wins; a foreign exported DEVENV_TOOLS is ignored).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/self-root.bash"
DEVENV_TOOLS="$(devenv_resolve_tools_root "${BASH_SOURCE[0]}")"
# issue-triage.sh - Interactive issue triage and workflow management
# Version: 1.0.0
# Description: Interactive wizard for grooming issues through TBD → To Groom → Ready workflow
# Requirements: Bash 4.0+, gh CLI, fzf
# Author: WorkInProgress.ai
# Last Modified: 2026-01-01

set -euo pipefail
# shellcheck disable=SC2034  # VERBOSE is written here; read by log_verbose in error-handling.bash
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
ISSUES=()
BUNDLE_OPTS=()
# shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
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

Interactive issue triage wizard to manage backlog and prepare issues for sprints.

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output

    -p, --project NAME          Filter by project
    -m, --milestone NAME        Filter by milestone
    --devenv                    Safety override to groom issues in devenv repo

CLI Apply Mode:
    $SCRIPT_NAME <ISSUE>... [BUNDLE-OPTIONS] [--yes]
        Apply a metadata bundle to one or more issues non-interactively
        and exit. All requested edits must succeed for exit 0.

    Bundle options:
        --title TEXT        Set issue title
        --body-file FILE    Set issue body from file
        --milestone NAME    Set milestone
        --assignee USER     Add assignee
        --label NAME        Add a label (repeatable)
        --triage-complete   Fire the triage-complete event; the Status
                            transition comes from skill-events.yml
                            (config-sourced; never hardcoded)

Workflow:
    TBD → To-Groom → Ready → Implementing → Review → Merged → Staging → Production
    (vocabulary is sourced from devenv.config [workflows])

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
    provider_issues_view "${repo_spec[1]:-}" "$issue_num"
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
                    provider_issues_edit "${repo_spec[1]:-}" "$issue_num" --title "$new_title"
                    log_info "Updated title"
                fi
                ;;
            3)
                # Open editor for body
                local tmpfile
                create_temp_file tmpfile issue-triage
                provider_issues_view "${repo_spec[1]:-}" "$issue_num" --json body -q .body > "$tmpfile"
                "${EDITOR:-nano}" "$tmpfile"
                provider_issues_edit "${repo_spec[1]:-}" "$issue_num" --body-file "$tmpfile"
                log_info "Updated description"
                log_info "Updated description"
                ;;
            4)
                set_milestone "$issue_num"
                ;;
            5)
                read -rp "Assignee username: " assignee
                if [ -n "$assignee" ]; then
                    provider_issues_edit "${repo_spec[1]:-}" "$issue_num" --add-assignee "$assignee"
                    log_info "Added assignee: $assignee"
                fi
                ;;
            6)
                read -rp "Label to add: " label
                if [ -n "$label" ]; then
                    provider_issues_edit "${repo_spec[1]:-}" "$issue_num" --add-label "$label"
                    log_info "Added label: $label"
                fi
                ;;
            7)
                read -rp "Parent issue number: " parent
                if [[ "$parent" =~ ^[0-9]+$ ]]; then
                    local current_body
                    current_body=$(provider_issues_view "${repo_spec[1]:-}" "$issue_num" --json body -q .body)
                    local new_body="Part of #${parent}\n\n${current_body}"
                    echo -e "$new_body" | provider_issues_edit "${repo_spec[1]:-}" "$issue_num" --body-file -
                    log_info "Linked to parent #$parent"
                fi
                ;;
            8)
                # Mark as Ready
                log_info "Marking issue #$issue_num as Ready"
                log_info "Note: Set Status=Ready in project manually or via GraphQL"
                provider_issues_edit "${repo_spec[1]:-}" "$issue_num" --remove-label "needs-grooming" 2>/dev/null || true
                provider_issues_edit "${repo_spec[1]:-}" "$issue_num" --add-label "status:ready"
                return 0
                ;;
            9)
                # Mark for grooming
                provider_issues_edit "${repo_spec[1]:-}" "$issue_num" --add-label "needs-grooming"
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
                provider_issues_view "${repo_spec[1]:-}" "$issue_num" --web
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
        provider_issues_edit "${repo_spec[1]:-}" "$issue_num" --remove-label "$label" 2>/dev/null || true
    done
    
    # Add new type label
    provider_issues_edit "${repo_spec[1]:-}" "$issue_num" --add-label "$type_label"
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
    provider_issues_milestones "${owner}/${repo}" --jq '.[] | "\(.number)) \(.title) (due: \(.due_on // "no date"))"'
    echo ""
    read -rp "Milestone title or number: " milestone_choice
    
    if [ -n "$milestone_choice" ]; then
        provider_issues_edit "${repo_spec[1]:-}" "$issue_num" --milestone "$milestone_choice"
        log_info "Set milestone to: $milestone_choice"
    fi
}

# Run grooming session
apply_issue_bundle() {
    # CLI apply mode: one call applies a whole metadata bundle to one issue.
    # Exit 0 only if every requested edit succeeded. Status writes validate
    # against the configured workflow vocabulary - never hardcoded strings.
    local issue="$1"; shift
    local failed=0 did_any=0
    local repo_spec
    read -ra repo_spec <<< "$(get_repo_spec)"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --title)
                provider_issues_edit "${repo_spec[1]:-}" "$issue" --title "$2" >/dev/null 2>&1 || { log_error "title update failed"; failed=1; }
                did_any=1; shift 2 ;;
            --body-file)
                provider_issues_edit "${repo_spec[1]:-}" "$issue" --body-file "$2" >/dev/null 2>&1 || { log_error "body update failed"; failed=1; }
                did_any=1; shift 2 ;;
            --milestone)
                provider_issues_edit "${repo_spec[1]:-}" "$issue" --milestone "$2" >/dev/null 2>&1 || { log_error "milestone update failed"; failed=1; }
                did_any=1; shift 2 ;;
            --assignee)
                provider_issues_edit "${repo_spec[1]:-}" "$issue" --add-assignee "$2" >/dev/null 2>&1 || { log_error "assignee update failed"; failed=1; }
                did_any=1; shift 2 ;;
            --label)
                provider_issues_edit "${repo_spec[1]:-}" "$issue" --add-label "$2" >/dev/null 2>&1 || { log_error "label update failed for '$2'"; failed=1; }
                did_any=1; shift 2 ;;
            --triage-complete)
                # Fire the triage event; its configured transition comes from
                # skill-events.yml (config-sourced, best-effort).
                local tools_dir
                tools_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
                dispatcher="$tools_dir/scripts/_on_triage_complete.sh"
                if [ -f "$dispatcher" ]; then
                    bash "$dispatcher" "$issue" >/dev/null 2>&1 || { log_error "triage-complete signal failed"; failed=1; }
                else
                    log_error "event script scripts/_on_triage_complete.sh not found"; failed=1
                fi
                did_any=1; shift ;;
            *)
                log_error "unknown bundle option: $1"; failed=1; shift ;;
        esac
    done

    [ "$did_any" -eq 1 ] || { log_error "no bundle options given"; return 1; }
    return $failed
}

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
    # Global flags before auth/validation: --help must work without
    # a valid GitHub session or any positional args.
    if handle_global_flag "${1:-}"; then
        exit 0
    fi

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
                # shellcheck disable=SC2034  # read by log_verbose in error-handling.bash
                VERBOSE=1
                shift
                ;;
            -p|--project)
                # shellcheck disable=SC2034  # May be used in future feature
                PROJECT_NAME="$2"
                shift 2
                ;;
            -m|--milestone)
                # CLI bundle mode applies it; wizard filtering is a future use.
                # shellcheck disable=SC2034  # read by the wizard filter pass
                MILESTONE="$2"
                BUNDLE_OPTS+=("--milestone" "$2")
                shift 2
                ;;
            --devenv)
                # shellcheck disable=SC2034  # Used by check_target_repo
                ALLOW_DEVENV_REPO=1
                shift
                ;;
            --triage-complete)
                BUNDLE_OPTS+=("$1"); shift
                ;;
            --title|--body-file|--assignee|--label)
                BUNDLE_OPTS+=("$1" "$2"); shift 2
                ;;
            *)
                if [[ "$1" =~ ^[0-9]+$ ]]; then
                    ISSUES+=("$1")
                    shift
                else
                    log_error "Unknown option: $1"
                    echo "Use --help for usage information"
                    exit $EXIT_MISUSE
                fi
                ;;
        esac
    done
    
    # Check dependencies
    check_dependencies
    
    # Validate target repo
    check_target_repo
    
    # CLI apply mode: numeric positional args are issue numbers; apply the
    # bundle to each and exit (wizard is skipped entirely). Enables
    # skill-driven and scripted use; bulk sweeps pass multiple numbers.
    if [ ${#ISSUES[@]} -gt 0 ]; then
        local rc=0
        for issue in "${ISSUES[@]}"; do
            log_info "Applying triage bundle to issue #$issue..."
            apply_issue_bundle "$issue" "${BUNDLE_OPTS[@]}" || rc=1
        done
        exit $rc
    fi
    
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
