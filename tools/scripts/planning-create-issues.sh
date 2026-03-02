#!/bin/bash
# planning-create-issues.sh - Create GitHub issues from a requirements document
# Version: 1.0.0
# Description: Parses a standardized requirements document and creates GitHub
#              issues for phases (as Epics), requirements (as Features), and
#              links them with parent-child relationships.
# Requirements: Bash 4.0+, gh CLI, issue-create
# Author: WorkInProgress.ai
# Last Modified: 2026-03-01

set -euo pipefail
source "$DEVENV_TOOLS/lib/error-handling.bash"
source "$DEVENV_TOOLS/lib/github-helpers.bash"
source "$DEVENV_TOOLS/lib/validation.bash"
source "$DEVENV_TOOLS/lib/requirements-parser.bash"
source "$DEVENV_TOOLS/lib/issues-config.bash"
source "$DEVENV_TOOLS/lib/fzf-selection.bash"

readonly SCRIPT_VERSION="1.0.0"
SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_NAME

# ============================================================================
# Global Variables
# ============================================================================

MARKDOWN_FILE=""
CREATE_ALL=0
INTERACTIVE=0
DRY_RUN=0
VERBOSE=0
CHECK_MODE=0
NO_EXPAND=0
PROJECT=""
MILESTONE=""
SELECTED_IDS=()

# Associative array: tracks created issue numbers keyed by ID (PHASE-01, REQ-001, etc.)
declare -A CREATED_ISSUES=()

# ============================================================================
# Helper Functions
# ============================================================================

show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS] [ID...]

Create GitHub issues from a standardized requirements document.

Phases become Epic issues, requirements become Feature issues. Issues are
linked via parent-child relationships and reference the requirements document.

Arguments:
    ID...                       One or more phase or requirement IDs to create
                                (e.g., PHASE-01 REQ-001 AUTH-003)

Options:
    -h, --help                  Show this help message and exit
    -v, --version               Show version information and exit
    -V, --verbose               Enable verbose output
    -n, --dry-run               Show what would be done without creating issues
    --check                     Validate the document structure without creating issues

Required:
    --markdown FILE             Path to the requirements markdown document

Selection:
    --all                       Create issues for all phases and requirements
    -i, --interactive           Interactively select which issues to create
    --no-expand                 Don't expand phases into child requirements;
                                create only the specified items

Optional:
    -p, --project NAME          Assign issues to a project
    -m, --milestone NAME        Assign issues to a milestone

Examples:
    # Create issues for everything in the document
    $SCRIPT_NAME --markdown docs/requirements.md --all

    # Create issues for a specific phase and its requirements
    $SCRIPT_NAME --markdown docs/requirements.md PHASE-01

    # Create only the phase epic (no child requirements)
    $SCRIPT_NAME --markdown docs/requirements.md --no-expand PHASE-01

    # Create issues for specific requirements
    $SCRIPT_NAME --markdown docs/requirements.md REQ-001 REQ-002

    # Interactive selection
    $SCRIPT_NAME --markdown docs/requirements.md -i

    # Dry run to preview what would be created
    $SCRIPT_NAME --markdown docs/requirements.md --all --dry-run

    # With project and milestone
    $SCRIPT_NAME --markdown docs/requirements.md --all \\
        --project "Q2 2026" --milestone "Sprint 1"
EOF
}

# ============================================================================
# Argument Parsing
# ============================================================================

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                show_usage
                exit 0
                ;;
            -v|--version)
                echo "$SCRIPT_NAME version $SCRIPT_VERSION"
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
            --check)
                CHECK_MODE=1
                shift
                ;;
            --markdown)
                MARKDOWN_FILE="${2:?Error: --markdown requires a file path}"
                shift 2
                ;;
            --all)
                CREATE_ALL=1
                shift
                ;;
            --no-expand)
                NO_EXPAND=1
                shift
                ;;
            -i|--interactive)
                INTERACTIVE=1
                shift
                ;;
            -p|--project)
                PROJECT="${2:?Error: --project requires a name}"
                shift 2
                ;;
            -m|--milestone)
                MILESTONE="${2:?Error: --milestone requires a name}"
                shift 2
                ;;
            -*)
                die "Unknown option: $1. Use --help for usage."
                ;;
            *)
                # Positional arguments are IDs
                SELECTED_IDS+=("$1")
                shift
                ;;
        esac
    done
}

validate_args() {
    if [ -z "$MARKDOWN_FILE" ]; then
        die "Missing required option: --markdown FILE. Use --help for usage."
    fi

    validate_file_exists "$MARKDOWN_FILE" "markdown document"

    # --check mode only needs the file, no selection required
    if [[ $CHECK_MODE -eq 1 ]]; then
        return 0
    fi

    if [[ $CREATE_ALL -eq 0 ]] && [[ $INTERACTIVE -eq 0 ]] && [[ ${#SELECTED_IDS[@]} -eq 0 ]]; then
        die "No items selected. Use --all, --interactive, or specify IDs. Use --help for usage."
    fi

    if [[ $CREATE_ALL -eq 1 ]] && [[ ${#SELECTED_IDS[@]} -gt 0 ]]; then
        die "Cannot use --all with specific IDs. Use one or the other."
    fi

    if [[ $INTERACTIVE -eq 1 ]] && [[ $CREATE_ALL -eq 1 ]]; then
        die "Cannot use --interactive with --all. Use one or the other."
    fi
}

# ============================================================================
# Repository Context
# ============================================================================

# Determine repo URL and markdown path relative to repo root for linking.
#
# Sets global variables:
#   REPO_URL         - GitHub repo URL (e.g., https://github.com/owner/repo)
#   MARKDOWN_REL_PATH - Path to markdown relative to repo root
#   DEFAULT_BRANCH   - Default branch name
setup_repo_context() {
    local repo_root
    repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || die "Not in a git repository"

    local repo_name
    if [ -n "${GITHUB_REPO:-}" ]; then
        repo_name="$GITHUB_REPO"
    else
        repo_name=$(get_full_repo_name "$repo_root") || die "Could not determine repository name. Set GITHUB_REPO=owner/repo."
    fi

    REPO_URL="https://github.com/${repo_name}"

    # Compute relative path of markdown file from repo root
    local abs_markdown
    abs_markdown=$(cd "$(dirname "$MARKDOWN_FILE")" && pwd)/$(basename "$MARKDOWN_FILE")
    MARKDOWN_REL_PATH="${abs_markdown#${repo_root}/}"

    if [ -z "${DEFAULT_BRANCH:-}" ]; then
        DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}' || true)
        DEFAULT_BRANCH="${DEFAULT_BRANCH:-master}"
    fi

    if [[ $VERBOSE -eq 1 ]]; then
        log_info "Repository: $repo_name"
        log_info "Markdown path: $MARKDOWN_REL_PATH"
        log_info "Default branch: $DEFAULT_BRANCH"
    fi
}

# ============================================================================
# ID Resolution
# ============================================================================

# Expand a phase ID into the phase itself plus all its requirements.
# If the ID is already a requirement, return it as-is.
#
# Arguments:
#   --no-expand   Skip expanding phases into their child requirements.
#                 Useful when the caller already performed explicit selection.
resolve_ids() {
    local expand_phases=1
    if [[ "${1:-}" == "--no-expand" ]]; then
        expand_phases=0
    fi

    local -a resolved=()

    for id in "${SELECTED_IDS[@]}"; do
        if [[ "$id" =~ ^PHASE-[0-9]+$ ]]; then
            resolved+=("$id")
            # Expand phase into its child requirements (unless suppressed)
            if [[ $expand_phases -eq 1 ]]; then
                local reqs
                reqs=$(get_phase_requirements "$MARKDOWN_FILE" "$id" 2>/dev/null) || true
                if [ -n "$reqs" ]; then
                    IFS=',' read -ra req_arr <<< "$reqs"
                    for r in "${req_arr[@]}"; do
                        resolved+=("$r")
                    done
                fi
            fi
        elif [[ "$id" =~ ^[A-Z]+-[0-9]+$ ]]; then
            # It's a requirement — include it and find its parent phase
            local parent_phase
            parent_phase=$(find_phase_for_requirement "$MARKDOWN_FILE" "$id" 2>/dev/null) || true
            if [ -n "$parent_phase" ]; then
                # Add the parent phase if not already present
                local already_present=0
                for existing in "${resolved[@]+"${resolved[@]}"}"; do
                    if [[ "$existing" == "$parent_phase" ]]; then
                        already_present=1
                        break
                    fi
                done
                if [[ $already_present -eq 0 ]]; then
                    resolved+=("$parent_phase")
                fi
            fi
            resolved+=("$id")
        else
            log_warn "Unrecognized ID format: $id (skipping)"
        fi
    done

    # Deduplicate while preserving order
    local -a deduped=()
    local -A seen=()
    for id in "${resolved[@]+"${resolved[@]}"}"; do
        if [ -z "${seen[$id]:-}" ]; then
            deduped+=("$id")
            seen[$id]=1
        fi
    done

    SELECTED_IDS=("${deduped[@]+"${deduped[@]}"}")
}

# Collect all IDs when --all is specified.
collect_all_ids() {
    local -a all_ids=()

    # First add all phases in order
    while IFS='|' read -r phase_id _rest; do
        all_ids+=("$phase_id")
    done < <(parse_phases "$MARKDOWN_FILE")

    # Then add all requirements in order
    while IFS='|' read -r req_id _rest; do
        all_ids+=("$req_id")
    done < <(parse_requirements "$MARKDOWN_FILE")

    if [[ ${#all_ids[@]} -eq 0 ]]; then
        die "No phases or requirements found in $MARKDOWN_FILE"
    fi

    SELECTED_IDS=("${all_ids[@]}")
}

# ============================================================================
# Interactive Selection
# ============================================================================

interactive_select() {
    local -a display_lines=()
    local skipped_count=0

    # Build display lines for phases (skip those with existing issues)
    while IFS='|' read -r phase_id phase_name _goal _scope _prereqs phase_reqs; do
        if has_existing_issue "$MARKDOWN_FILE" "$phase_id"; then
            ((skipped_count++)) || true
            # Still record the existing issue so it can be used as a parent reference
            local existing_num
            existing_num=$(get_existing_issue "$MARKDOWN_FILE" "$phase_id") || true
            if [ -n "$existing_num" ]; then
                CREATED_ISSUES[$phase_id]="$existing_num"
            fi
            continue
        fi
        local req_count=0
        if [ -n "$phase_reqs" ] && [ "$phase_reqs" != "" ]; then
            IFS=',' read -ra _reqs <<< "$phase_reqs"
            req_count=${#_reqs[@]}
        fi
        display_lines+=("[Epic] ${phase_id}: ${phase_name} (${req_count} requirements)")
    done < <(parse_phases "$MARKDOWN_FILE")

    # Build display lines for requirements (skip those with existing issues)
    while IFS='|' read -r req_id req_title req_area _deps; do
        if has_existing_issue "$MARKDOWN_FILE" "$req_id"; then
            ((skipped_count++)) || true
            continue
        fi
        display_lines+=("[Feature] ${req_id}: ${req_title} (${req_area})")
    done < <(parse_requirements "$MARKDOWN_FILE")

    if [[ $skipped_count -gt 0 ]]; then
        log_info "$skipped_count item(s) already have GitHub issues (not shown)"
    fi

    if [[ ${#display_lines[@]} -eq 0 ]]; then
        die "No phases or requirements found in $MARKDOWN_FILE"
    fi

    check_fzf_installed || die "fzf is required for interactive selection"

    # Build newline-separated list for fzf
    local items
    items=$(printf '%s\n' "${display_lines[@]}")

    local selected
    selected=$(fzf_select_multi "$items" "Select issues to create: ") \
        || die "No items selected"

    # Map selected display lines back to IDs
    while IFS= read -r line; do
        # Extract ID from display format: "[Type] ID: ..."
        local id
        id=$(echo "$line" | awk '{print $2}' | tr -d ':')
        if [ -n "$id" ]; then
            SELECTED_IDS+=("$id")
        fi
    done <<< "$selected"

    if [[ ${#SELECTED_IDS[@]} -eq 0 ]]; then
        die "No items selected"
    fi

    # Resolve dependencies (add parent phases for selected requirements)
    # --no-expand: user already chose exactly what to create; don't auto-add
    # child requirements for selected phases.
    resolve_ids --no-expand
}

# ============================================================================
# Issue Creation
# ============================================================================

# Build the body text for a phase (Epic) issue.
build_phase_body() {
    local phase_id="$1"
    local phase_name="$2"
    local phase_goal="$3"
    local phase_scope="$4"
    local phase_reqs="$5"

    local link="${REPO_URL}/blob/${DEFAULT_BRANCH}/${MARKDOWN_REL_PATH}"
    local anchor
    anchor=$(_build_anchor "$phase_id" "$phase_name")

    cat << EOF
## ${phase_id}: ${phase_name}

**Goal:** ${phase_goal}

**Scope:** ${phase_scope}

**Source:** [Requirements Document — ${phase_id}](${link}#${anchor})

### Requirements in this phase

EOF

    if [ -n "$phase_reqs" ]; then
        IFS=',' read -ra req_arr <<< "$phase_reqs"
        for req_id in "${req_arr[@]}"; do
            local req_detail
            req_detail=$(get_requirement_detail "$MARKDOWN_FILE" "$req_id" 2>/dev/null) || true
            if [ -n "$req_detail" ]; then
                local req_title
                req_title=$(echo "$req_detail" | cut -d'|' -f2)
                local req_anchor
                req_anchor=$(_build_anchor "$req_id" "$req_title")
                echo "- [${req_id}: ${req_title}](${link}#${req_anchor})"
            else
                echo "- ${req_id}"
            fi
        done
    fi
}

# Build the body text for a requirement (Feature) issue.
build_requirement_body() {
    local req_id="$1"
    local req_title="$2"
    local req_area="$3"
    local req_deps="$4"

    local link="${REPO_URL}/blob/${DEFAULT_BRANCH}/${MARKDOWN_REL_PATH}"
    local anchor
    anchor=$(_build_anchor "$req_id" "$req_title")

    cat << EOF
## ${req_id}: ${req_title}

**Functional Area:** ${req_area}

**Source:** [Requirements Document — ${req_id}](${link}#${anchor})

Refer to the requirements document for full description, acceptance criteria, and details.
EOF

    if [ "$req_deps" != "None" ] && [ -n "$req_deps" ]; then
        echo ""
        echo "### Dependencies"
        echo ""
        IFS=',' read -ra dep_arr <<< "$req_deps"
        for dep_id in "${dep_arr[@]}"; do
            local dep_detail
            dep_detail=$(get_requirement_detail "$MARKDOWN_FILE" "$dep_id" 2>/dev/null) || true
            if [ -n "$dep_detail" ]; then
                local dep_title
                dep_title=$(echo "$dep_detail" | cut -d'|' -f2)
                local dep_anchor
                dep_anchor=$(_build_anchor "$dep_id" "$dep_title")
                echo "- [${dep_id}: ${dep_title}](${link}#${dep_anchor})"
            else
                echo "- ${dep_id}"
            fi
        done
    fi
}

# Create a single issue via issue-create.
#
# Arguments:
#   title       - Issue title
#   body        - Issue body (markdown)
#   type        - Issue type (Epic, Feature, Task)
#   parent_num  - Parent issue number (optional, empty string if none)
#   blocked_by  - Comma-separated list of issue numbers this is blocked by (optional)
#
# Output (stdout):
#   Created issue number
create_single_issue() {
    local title="$1"
    local body="$2"
    local type="$3"
    local parent_num="${4:-}"
    local blocked_by="${5:-}"

    local -a cmd_args=()
    cmd_args+=(issue-create)
    cmd_args+=(--title "$title")
    cmd_args+=(--type "$type")
    cmd_args+=(--no-template)
    cmd_args+=(--no-interactive)

    if [ -n "$body" ]; then
        # Write body to temp file for --body-file
        local body_file
        body_file=$(mktemp)
        echo "$body" > "$body_file"
        cmd_args+=(--body-file "$body_file")
    fi

    if [ -n "$parent_num" ]; then
        cmd_args+=(--parent "$parent_num")
    fi

    if [ -n "$blocked_by" ]; then
        IFS=',' read -ra blocked_arr <<< "$blocked_by"
        for blocked_num in "${blocked_arr[@]}"; do
            cmd_args+=(--blocked-by "$blocked_num")
        done
    fi

    if [ -n "$PROJECT" ]; then
        cmd_args+=(--project "$PROJECT")
    fi

    if [ -n "$MILESTONE" ]; then
        cmd_args+=(--milestone "$MILESTONE")
    fi

    if [[ $DRY_RUN -eq 1 ]]; then
        log_info "[DRY RUN] Would create issue:"
        log_info "  Title: $title"
        log_info "  Type: $type"
        [ -n "$parent_num" ] && log_info "  Parent: #$parent_num"
        [ -n "$blocked_by" ] && log_info "  Blocked by: $blocked_by"
        [ -n "$PROJECT" ] && log_info "  Project: $PROJECT"
        [ -n "$MILESTONE" ] && log_info "  Milestone: $MILESTONE"
        # Clean up temp file
        [ -n "${body_file:-}" ] && rm -f "$body_file"
        echo "DRY-RUN-0"
        return 0
    fi

    if [[ $VERBOSE -eq 1 ]]; then
        log_info "Creating issue: $title (type: $type)"
    fi

    local output
    output=$("${cmd_args[@]}" 2>&1) || {
        log_error "Failed to create issue: $title"
        log_error "Output: $output"
        # Clean up temp file
        [ -n "${body_file:-}" ] && rm -f "$body_file"
        return 1
    }

    # Clean up temp file
    [ -n "${body_file:-}" ] && rm -f "$body_file"

    # Extract issue number from output (look for a URL like .../issues/123 or just a number)
    local issue_num
    issue_num=$(echo "$output" | grep -oE '/issues/[0-9]+' | head -1 | grep -oE '[0-9]+' || true)

    if [ -z "$issue_num" ]; then
        # Try to extract just a number from the output
        issue_num=$(echo "$output" | grep -oE '#?[0-9]+' | head -1 | tr -d '#' || true)
    fi

    if [ -z "$issue_num" ]; then
        log_warn "Could not extract issue number from output: $output"
        echo "UNKNOWN"
        return 0
    fi

    echo "$issue_num"
}

# ============================================================================
# Orchestration
# ============================================================================

# Pre-populate CREATED_ISSUES with issue numbers from markdown annotations
# for any items referenced as dependencies/prerequisites/parents of the
# selected items. This ensures cross-session references work — if a
# dependency was created in a prior run, its annotated issue number is
# available for --parent and --blocked-by flags.
populate_existing_references() {
    local -A refs_to_check=()

    for id in "${SELECTED_IDS[@]}"; do
        if [[ "$id" =~ ^PHASE-[0-9]+$ ]]; then
            # Phase: check its prerequisites
            local phase_data
            phase_data=$(get_phase_detail "$MARKDOWN_FILE" "$id" 2>/dev/null) || continue
            local _pname _pgoal _pscope phase_prereqs _preqs
            IFS='|' read -r _ _pname _pgoal _pscope phase_prereqs _preqs <<< "$phase_data"
            if [ "$phase_prereqs" != "None" ] && [ -n "$phase_prereqs" ]; then
                IFS=',' read -ra prereq_arr <<< "$phase_prereqs"
                for prereq_id in "${prereq_arr[@]}"; do
                    refs_to_check[$prereq_id]=1
                done
            fi
        else
            # Requirement: check its parent phase and dependencies
            local parent_phase
            parent_phase=$(find_phase_for_requirement "$MARKDOWN_FILE" "$id" 2>/dev/null) || true
            if [ -n "$parent_phase" ]; then
                refs_to_check[$parent_phase]=1
            fi

            local req_data
            req_data=$(get_requirement_detail "$MARKDOWN_FILE" "$id" 2>/dev/null) || continue
            local _rtitle _rarea req_deps
            IFS='|' read -r _ _rtitle _rarea req_deps <<< "$req_data"
            if [ "$req_deps" != "None" ] && [ -n "$req_deps" ]; then
                IFS=',' read -ra dep_arr <<< "$req_deps"
                for dep_id in "${dep_arr[@]}"; do
                    refs_to_check[$dep_id]=1
                done
            fi
        fi
    done

    # For each referenced ID, if not already tracked, try to load from annotation
    for ref_id in "${!refs_to_check[@]}"; do
        if [ -z "${CREATED_ISSUES[$ref_id]:-}" ]; then
            local existing_num
            existing_num=$(get_existing_issue "$MARKDOWN_FILE" "$ref_id" 2>/dev/null) || true
            if [ -n "$existing_num" ]; then
                CREATED_ISSUES[$ref_id]="$existing_num"
                if [[ $VERBOSE -eq 1 ]]; then
                    log_info "Pre-loaded ${ref_id} => issue #${existing_num} (from prior run)"
                fi
            fi
        fi
    done
}

# Determine creation order: phases first, then requirements.
# Within each group, maintain document order.
build_creation_order() {
    local -a ordered_phases=()
    local -a ordered_reqs=()

    for id in "${SELECTED_IDS[@]}"; do
        if [[ "$id" =~ ^PHASE-[0-9]+$ ]]; then
            ordered_phases+=("$id")
        else
            ordered_reqs+=("$id")
        fi
    done

    SELECTED_IDS=("${ordered_phases[@]+"${ordered_phases[@]}"}" "${ordered_reqs[@]+"${ordered_reqs[@]}"}")
}

# Create all selected issues in dependency order.
create_issues() {
    build_creation_order
    populate_existing_references

    local total=${#SELECTED_IDS[@]}
    local created=0
    local failed=0

    log_info "Creating $total issue(s) from $MARKDOWN_FILE"
    echo ""

    for id in "${SELECTED_IDS[@]}"; do
        if [[ "$id" =~ ^PHASE-[0-9]+$ ]]; then
            create_phase_issue "$id" || { ((failed++)) || true; continue; }
        else
            create_requirement_issue "$id" || { ((failed++)) || true; continue; }
        fi
        ((created++)) || true
    done

    echo ""
    if [[ $DRY_RUN -eq 1 ]]; then
        log_info "[DRY RUN] Would have created $created issue(s)"
    else
        success "Created $created issue(s)"
    fi

    if [[ $failed -gt 0 ]]; then
        log_warn "$failed issue(s) failed to create"
        return 1
    fi
}

# Create an Epic issue for a phase.
create_phase_issue() {
    local phase_id="$1"

    # Check if issue already exists for this phase
    if has_existing_issue "$MARKDOWN_FILE" "$phase_id"; then
        local existing_num
        existing_num=$(get_existing_issue "$MARKDOWN_FILE" "$phase_id")
        log_info "${phase_id} already has issue #${existing_num} (skipping)"
        CREATED_ISSUES[$phase_id]="$existing_num"
        return 0
    fi

    local phase_data
    phase_data=$(get_phase_detail "$MARKDOWN_FILE" "$phase_id") || {
        log_error "Could not find phase: $phase_id"
        return 1
    }

    local phase_name phase_goal phase_scope phase_prereqs phase_reqs
    IFS='|' read -r _ phase_name phase_goal phase_scope phase_prereqs phase_reqs <<< "$phase_data"

    local title="${phase_id}: ${phase_name}"
    local body
    body=$(build_phase_body "$phase_id" "$phase_name" "$phase_goal" "$phase_scope" "$phase_reqs")
    body=$(expand_internal_links "$body" "${REPO_URL}/blob/${DEFAULT_BRANCH}/${MARKDOWN_REL_PATH}")

    # Determine parent: if this phase has prerequisites, link to the first prerequisite phase's epic
    local parent_num=""
    local blocked_by=""
    if [ "$phase_prereqs" != "None" ] && [ -n "$phase_prereqs" ]; then
        local first_prereq
        first_prereq=$(echo "$phase_prereqs" | cut -d',' -f1)
        parent_num="${CREATED_ISSUES[$first_prereq]:-}"

        # Build blocked-by list from all prerequisites that have been created
        local -a blocked_nums=()
        IFS=',' read -ra prereq_arr <<< "$phase_prereqs"
        for prereq_id in "${prereq_arr[@]}"; do
            local prereq_num="${CREATED_ISSUES[$prereq_id]:-}"
            if [ -n "$prereq_num" ]; then
                blocked_nums+=("$prereq_num")
            fi
        done
        if [ ${#blocked_nums[@]} -gt 0 ]; then
            blocked_by=$(IFS=','; echo "${blocked_nums[*]}")
        fi
    fi

    local phase_type
    phase_type=$(get_planning_type_mapping "phases") || die "Could not read planning type mapping for 'phases' from issues-config.yml"

    local issue_num
    issue_num=$(create_single_issue "$title" "$body" "$phase_type" "$parent_num" "$blocked_by") || return 1

    CREATED_ISSUES[$phase_id]="$issue_num"

    if [[ $DRY_RUN -eq 1 ]]; then
        log_info "[DRY RUN] ${phase_id} => ${phase_type} (dry run)"
    else
        log_info "${phase_id} => ${phase_type} #${issue_num}"
        # Annotate the markdown file with the issue link
        if [[ "$issue_num" != "UNKNOWN" ]]; then
            annotate_issue "$MARKDOWN_FILE" "$phase_id" "$issue_num" "${REPO_URL}/issues/${issue_num}"
        fi
    fi
}

# Create a Feature issue for a requirement.
create_requirement_issue() {
    local req_id="$1"

    # Check if issue already exists for this requirement
    if has_existing_issue "$MARKDOWN_FILE" "$req_id"; then
        local existing_num
        existing_num=$(get_existing_issue "$MARKDOWN_FILE" "$req_id")
        log_info "${req_id} already has issue #${existing_num} (skipping)"
        CREATED_ISSUES[$req_id]="$existing_num"
        return 0
    fi

    local req_data
    req_data=$(get_requirement_detail "$MARKDOWN_FILE" "$req_id") || {
        log_error "Could not find requirement: $req_id"
        return 1
    }

    local req_title req_area req_deps
    IFS='|' read -r _ req_title req_area req_deps <<< "$req_data"

    local title="${req_id}: ${req_title}"
    local body
    body=$(build_requirement_body "$req_id" "$req_title" "$req_area" "$req_deps")
    body=$(expand_internal_links "$body" "${REPO_URL}/blob/${DEFAULT_BRANCH}/${MARKDOWN_REL_PATH}")

    # Determine parent: find the phase this requirement belongs to
    local parent_num=""
    local parent_phase
    parent_phase=$(find_phase_for_requirement "$MARKDOWN_FILE" "$req_id" 2>/dev/null) || true
    if [ -n "$parent_phase" ]; then
        parent_num="${CREATED_ISSUES[$parent_phase]:-}"
    fi

    # Build blocked-by list from all dependencies that have been created
    local blocked_by=""
    if [ "$req_deps" != "None" ] && [ -n "$req_deps" ]; then
        local -a blocked_nums=()
        IFS=',' read -ra dep_arr <<< "$req_deps"
        for dep_id in "${dep_arr[@]}"; do
            local dep_num="${CREATED_ISSUES[$dep_id]:-}"
            if [ -n "$dep_num" ]; then
                blocked_nums+=("$dep_num")
            fi
        done
        if [ ${#blocked_nums[@]} -gt 0 ]; then
            blocked_by=$(IFS=','; echo "${blocked_nums[*]}")
        fi
    fi

    local req_type
    req_type=$(get_planning_type_mapping "features") || die "Could not read planning type mapping for 'features' from issues-config.yml"

    local issue_num
    issue_num=$(create_single_issue "$title" "$body" "$req_type" "$parent_num" "$blocked_by") || return 1

    CREATED_ISSUES[$req_id]="$issue_num"

    if [[ $DRY_RUN -eq 1 ]]; then
        log_info "[DRY RUN] ${req_id} => ${req_type} (dry run)"
    else
        log_info "${req_id} => ${req_type} #${issue_num}"
        # Annotate the markdown file with the issue link
        if [[ "$issue_num" != "UNKNOWN" ]]; then
            annotate_issue "$MARKDOWN_FILE" "$req_id" "$issue_num" "${REPO_URL}/issues/${issue_num}"
        fi
    fi
}

# ============================================================================
# Main
# ============================================================================

main() {
    parse_args "$@"
    validate_args

    if [[ $CHECK_MODE -eq 1 ]]; then
        validate_document "$MARKDOWN_FILE"
        exit $?
    fi

    setup_repo_context

    if [[ $CREATE_ALL -eq 1 ]]; then
        collect_all_ids
    elif [[ $INTERACTIVE -eq 1 ]]; then
        interactive_select
    else
        if [[ $NO_EXPAND -eq 1 ]]; then
            resolve_ids --no-expand
        else
            resolve_ids
        fi
    fi

    if [[ $VERBOSE -eq 1 ]]; then
        log_info "Items to create: ${SELECTED_IDS[*]}"
    fi

    create_issues
}

main "$@"
