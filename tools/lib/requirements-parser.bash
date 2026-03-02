#!/usr/bin/env bash
# requirements-parser.bash - Parse standardized requirements documents
# Extracts phases (PHASE-nn), requirements (PREFIX-nnn), and their relationships
# from markdown documents following the NOICE requirements gathering format.

# Guard against multiple sourcing
if [ -n "${_REQUIREMENTS_PARSER_LOADED:-}" ]; then
    return 0
fi
_REQUIREMENTS_PARSER_LOADED=1

# Ensure dependencies are available
if [ -z "${_ERROR_HANDLING_LOADED:-}" ] && [ -f "${DEVENV_TOOLS}/lib/error-handling.bash" ]; then
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/error-handling.bash"
fi

if [ -z "${_VALIDATION_LOADED:-}" ] && [ -f "${DEVENV_TOOLS}/lib/validation.bash" ]; then
    # shellcheck disable=SC1091
    source "${DEVENV_TOOLS}/lib/validation.bash"
fi

# ============================================================================
# Parsing Functions
# ============================================================================

# Parse phases from the implementation plan section of a requirements document.
#
# Extracts PHASE-nn entries with their name, goal, included requirements,
# prerequisites, and scope.
#
# Usage:
#   parse_phases <markdown_file>
#
# Arguments:
#   markdown_file  Path to the requirements markdown document
#
# Output (stdout):
#   One line per phase, pipe-delimited:
#   PHASE_ID|Name|Goal|Scope|Prerequisites|REQ-001,REQ-002,...
#
# Returns:
#   0 on success, 1 if file not found or no phases found
parse_phases() {
    local markdown_file="${1:?Usage: parse_phases <markdown_file>}"

    if [ ! -f "$markdown_file" ]; then
        log_error "File not found: $markdown_file"
        return 1
    fi

    local in_impl_plan=0
    local in_phase=0
    local phase_id=""
    local phase_name=""
    local phase_goal=""
    local phase_scope=""
    local phase_prereqs=""
    local phase_reqs=""
    local in_reqs_list=0
    local found_any=0

    while IFS= read -r line || [ -n "$line" ]; do
        # Strip carriage return for CRLF compatibility
        line="${line%$'\r'}"

        # Detect implementation plan section (## 3. or ## 3 or ## Implementation Plan)
        if [[ "$line" =~ ^##[[:space:]]+3\.[[:space:]] ]] || [[ "$line" =~ ^##[[:space:]]+3[[:space:]] ]] || [[ "$line" =~ ^##[[:space:]]+[Ii]mplementation ]]; then
            in_impl_plan=1
            continue
        fi

        # If we hit another top-level ## section after the impl plan, stop
        if [[ $in_impl_plan -eq 1 ]] && [[ "$line" =~ ^##[[:space:]] ]] && ! [[ "$line" =~ ^###[[:space:]] ]] && ! [[ "$line" =~ ^##[[:space:]]+3 ]]; then
            # Emit the last phase if any
            if [[ $in_phase -eq 1 ]]; then
                _emit_phase "$phase_id" "$phase_name" "$phase_goal" "$phase_scope" "$phase_prereqs" "$phase_reqs"
                found_any=1
            fi
            break
        fi

        if [[ $in_impl_plan -eq 0 ]]; then
            continue
        fi

        # Detect phase heading: ### PHASE-nn: Name — Goal Statement
        if [[ "$line" =~ ^###[[:space:]]+(PHASE-[0-9]+):[[:space:]]+(.*) ]]; then
            # Emit previous phase if any
            if [[ $in_phase -eq 1 ]]; then
                _emit_phase "$phase_id" "$phase_name" "$phase_goal" "$phase_scope" "$phase_prereqs" "$phase_reqs"
                found_any=1
            fi

            phase_id="${BASH_REMATCH[1]}"
            local name_goal="${BASH_REMATCH[2]}"
            # Split on " — " or " - " to separate name from goal statement in heading
            if [[ "$name_goal" =~ ^(.+)[[:space:]]—[[:space:]](.+)$ ]]; then
                phase_name="${BASH_REMATCH[1]}"
                phase_goal="${BASH_REMATCH[2]}"
            elif [[ "$name_goal" =~ ^(.+)[[:space:]]-[[:space:]](.+)$ ]]; then
                phase_name="${BASH_REMATCH[1]}"
                phase_goal="${BASH_REMATCH[2]}"
            else
                phase_name="$name_goal"
                phase_goal=""
            fi
            phase_scope=""
            phase_prereqs=""
            phase_reqs=""
            in_phase=1
            in_reqs_list=0
            continue
        fi

        if [[ $in_phase -eq 0 ]]; then
            continue
        fi

        # Parse **Goal:** line (may override heading goal)
        if [[ "$line" =~ ^\*\*Goal:\*\*[[:space:]]*(.*) ]]; then
            phase_goal="${BASH_REMATCH[1]}"
            in_reqs_list=0
            continue
        fi

        # Parse **Scope:** line
        if [[ "$line" =~ ^\*\*Scope:\*\*[[:space:]]*(.*) ]]; then
            phase_scope="${BASH_REMATCH[1]}"
            in_reqs_list=0
            continue
        fi

        # Parse **Prerequisites:** or **Prerequisite:** line
        if [[ "$line" =~ ^\*\*[Pp]rerequisites?:\*\*[[:space:]]*(.*) ]]; then
            local prereq_val="${BASH_REMATCH[1]}"
            # Extract PHASE-nn references from the value
            phase_prereqs="$(_extract_phase_refs "$prereq_val")"
            in_reqs_list=0
            continue
        fi

        # Detect start of requirements list (**Requirements Included:** or **Requirements:**)
        if [[ "$line" =~ ^\*\*Requirements([[:space:]][Ii]ncluded)?:\*\* ]]; then
            in_reqs_list=1
            continue
        fi

        # Parse requirement list items (bullet lines with REQ IDs)
        if [[ $in_reqs_list -eq 1 ]]; then
            if [[ "$line" =~ ^[[:space:]]*[-*][[:space:]] ]]; then
                local req_id
                req_id="$(_extract_req_id "$line")"
                if [ -n "$req_id" ]; then
                    if [ -n "$phase_reqs" ]; then
                        phase_reqs="${phase_reqs},${req_id}"
                    else
                        phase_reqs="$req_id"
                    fi
                fi
                continue
            elif [[ "$line" =~ ^[[:space:]]*$ ]]; then
                # Skip blank lines within the requirements list
                continue
            else
                # Non-bullet, non-blank line ends the requirements list
                in_reqs_list=0
            fi
        fi

        # A horizontal rule signals end of this phase section
        if [[ "$line" =~ ^---[[:space:]]*$ ]] && [[ $in_phase -eq 1 ]]; then
            _emit_phase "$phase_id" "$phase_name" "$phase_goal" "$phase_scope" "$phase_prereqs" "$phase_reqs"
            found_any=1
            in_phase=0
            phase_id=""
            phase_name=""
            phase_goal=""
            phase_scope=""
            phase_prereqs=""
            phase_reqs=""
            continue
        fi
    done < "$markdown_file"

    # Emit last phase if file ended without a trailing ---
    if [[ $in_phase -eq 1 ]]; then
        _emit_phase "$phase_id" "$phase_name" "$phase_goal" "$phase_scope" "$phase_prereqs" "$phase_reqs"
        found_any=1
    fi

    if [[ $found_any -eq 0 ]]; then
        log_warn "No phases found in $markdown_file"
        return 1
    fi

    return 0
}

# Parse requirements from the requirements section of a document.
#
# Extracts requirement entries with their ID, title, description,
# acceptance criteria, dependencies, and functional area.
#
# Usage:
#   parse_requirements <markdown_file>
#
# Arguments:
#   markdown_file  Path to the requirements markdown document
#
# Output (stdout):
#   One line per requirement, pipe-delimited:
#   REQ_ID|Title|Functional_Area|Dependencies
#
#   Dependencies is a comma-separated list of requirement IDs, or "None"
#
# Returns:
#   0 on success, 1 if file not found or no requirements found
parse_requirements() {
    local markdown_file="${1:?Usage: parse_requirements <markdown_file>}"

    if [ ! -f "$markdown_file" ]; then
        log_error "File not found: $markdown_file"
        return 1
    fi

    local in_req_section=0
    local in_req=0
    local req_id=""
    local req_title=""
    local req_area=""
    local req_deps=""
    local found_any=0

    while IFS= read -r line || [ -n "$line" ]; do
        # Strip carriage return for CRLF compatibility
        line="${line%$'\r'}"

        # Detect requirements section (## 2. or ## 2 or ## Requirements)
        if [[ "$line" =~ ^##[[:space:]]+2\.[[:space:]] ]] || [[ "$line" =~ ^##[[:space:]]+2[[:space:]] ]] || [[ "$line" =~ ^##[[:space:]]+[Rr]equirements ]]; then
            in_req_section=1
            continue
        fi

        # If we hit another top-level ## section after requirements, stop
        if [[ $in_req_section -eq 1 ]] && [[ "$line" =~ ^##[[:space:]] ]] && ! [[ "$line" =~ ^###[[:space:]] ]] && ! [[ "$line" =~ ^####[[:space:]] ]] && ! [[ "$line" =~ ^##[[:space:]]+2 ]]; then
            if [[ $in_req -eq 1 ]]; then
                _emit_requirement "$req_id" "$req_title" "$req_area" "$req_deps"
                found_any=1
            fi
            break
        fi

        if [[ $in_req_section -eq 0 ]]; then
            continue
        fi

        # Detect functional area heading: ### 2.n Name or ### Name
        if [[ "$line" =~ ^###[[:space:]]+(.*) ]]; then
            local area_text="${BASH_REMATCH[1]}"
            # Skip if this is actually a phase heading (shouldn't happen in section 2)
            if [[ "$area_text" =~ ^PHASE- ]]; then
                continue
            fi
            # Strip leading number prefix like "2.1 "
            if [[ "$area_text" =~ ^[0-9]+\.[0-9]+[[:space:]]+(.*) ]]; then
                req_area="${BASH_REMATCH[1]}"
            else
                req_area="$area_text"
            fi
            continue
        fi

        # Detect requirement heading: #### REQ-001: Title or #### PREFIX-001: Title
        if [[ "$line" =~ ^####[[:space:]]+([A-Z]+-[0-9]+):[[:space:]]+(.*) ]]; then
            # Emit previous requirement if any
            if [[ $in_req -eq 1 ]]; then
                _emit_requirement "$req_id" "$req_title" "$req_area" "$req_deps"
                found_any=1
            fi

            req_id="${BASH_REMATCH[1]}"
            req_title="${BASH_REMATCH[2]}"
            req_deps="None"
            in_req=1
            continue
        fi

        if [[ $in_req -eq 0 ]]; then
            continue
        fi

        # Parse **Dependencies:** line
        if [[ "$line" =~ ^\*\*Dependencies:\*\*[[:space:]]*(.*) ]]; then
            local dep_val="${BASH_REMATCH[1]}"
            if [[ "$dep_val" =~ ^[Nn]one ]] || [ -z "$dep_val" ]; then
                req_deps="None"
            else
                req_deps="$(_extract_all_req_ids "$dep_val")"
                if [ -z "$req_deps" ]; then
                    req_deps="None"
                fi
            fi
            continue
        fi

        # A horizontal rule signals end of this requirement section
        if [[ "$line" =~ ^---[[:space:]]*$ ]] && [[ $in_req -eq 1 ]]; then
            _emit_requirement "$req_id" "$req_title" "$req_area" "$req_deps"
            found_any=1
            in_req=0
            req_id=""
            req_title=""
            req_deps=""
            continue
        fi
    done < "$markdown_file"

    # Emit last requirement if file ended without a trailing ---
    if [[ $in_req -eq 1 ]]; then
        _emit_requirement "$req_id" "$req_title" "$req_area" "$req_deps"
        found_any=1
    fi

    if [[ $found_any -eq 0 ]]; then
        log_warn "No requirements found in $markdown_file"
        return 1
    fi

    return 0
}

# Get the list of requirement IDs belonging to a specific phase.
#
# Usage:
#   get_phase_requirements <markdown_file> <phase_id>
#
# Arguments:
#   markdown_file  Path to the requirements markdown document
#   phase_id       Phase identifier (e.g., PHASE-01)
#
# Output (stdout):
#   Comma-separated list of requirement IDs
#
# Returns:
#   0 on success, 1 if phase not found
get_phase_requirements() {
    local markdown_file="${1:?Usage: get_phase_requirements <markdown_file> <phase_id>}"
    local phase_id="${2:?Usage: get_phase_requirements <markdown_file> <phase_id>}"

    local result
    result=$(parse_phases "$markdown_file" | grep "^${phase_id}|" | head -1 | cut -d'|' -f6)

    if [ -z "$result" ]; then
        log_error "Phase not found: $phase_id"
        return 1
    fi

    echo "$result"
}

# Get details for a specific requirement by ID.
#
# Usage:
#   get_requirement_detail <markdown_file> <req_id>
#
# Arguments:
#   markdown_file  Path to the requirements markdown document
#   req_id         Requirement identifier (e.g., REQ-001)
#
# Output (stdout):
#   Pipe-delimited: REQ_ID|Title|Functional_Area|Dependencies
#
# Returns:
#   0 on success, 1 if requirement not found
get_requirement_detail() {
    local markdown_file="${1:?Usage: get_requirement_detail <markdown_file> <req_id>}"
    local req_id="${2:?Usage: get_requirement_detail <markdown_file> <req_id>}"

    local result
    result=$(parse_requirements "$markdown_file" | grep "^${req_id}|" | head -1)

    if [ -z "$result" ]; then
        log_error "Requirement not found: $req_id"
        return 1
    fi

    echo "$result"
}

# Get details for a specific phase by ID.
#
# Usage:
#   get_phase_detail <markdown_file> <phase_id>
#
# Arguments:
#   markdown_file  Path to the requirements markdown document
#   phase_id       Phase identifier (e.g., PHASE-01)
#
# Output (stdout):
#   Pipe-delimited: PHASE_ID|Name|Goal|Scope|Prerequisites|REQ-001,REQ-002,...
#
# Returns:
#   0 on success, 1 if phase not found
get_phase_detail() {
    local markdown_file="${1:?Usage: get_phase_detail <markdown_file> <phase_id>}"
    local phase_id="${2:?Usage: get_phase_detail <markdown_file> <phase_id>}"

    local result
    result=$(parse_phases "$markdown_file" | grep "^${phase_id}|" | head -1)

    if [ -z "$result" ]; then
        log_error "Phase not found: $phase_id"
        return 1
    fi

    echo "$result"
}

# Find which phase a requirement belongs to.
#
# Usage:
#   find_phase_for_requirement <markdown_file> <req_id>
#
# Arguments:
#   markdown_file  Path to the requirements markdown document
#   req_id         Requirement identifier (e.g., REQ-001)
#
# Output (stdout):
#   Phase ID (e.g., PHASE-01), or empty if not found
#
# Returns:
#   0 on success, 1 if requirement not assigned to any phase
find_phase_for_requirement() {
    local markdown_file="${1:?Usage: find_phase_for_requirement <markdown_file> <req_id>}"
    local req_id="${2:?Usage: find_phase_for_requirement <markdown_file> <req_id>}"

    local phase_line
    while IFS= read -r phase_line; do
        local reqs_field
        reqs_field=$(echo "$phase_line" | cut -d'|' -f6)
        if echo ",$reqs_field," | grep -q ",${req_id},"; then
            echo "$phase_line" | cut -d'|' -f1
            return 0
        fi
    done < <(parse_phases "$markdown_file")

    return 1
}

# Build a markdown link to a specific requirement in the document.
#
# Usage:
#   build_requirement_link <repo_url> <markdown_path> <req_id> <req_title>
#
# Arguments:
#   repo_url       Base repo URL (e.g., https://github.com/owner/repo)
#   markdown_path  Path to the markdown file relative to repo root
#   req_id         Requirement identifier (e.g., REQ-001)
#   req_title      Requirement title
#
# Output (stdout):
#   Markdown link to the requirement section
build_requirement_link() {
    local repo_url="${1:?Usage: build_requirement_link <repo_url> <markdown_path> <req_id> <req_title>}"
    local markdown_path="${2:?}"
    local req_id="${3:?}"
    local req_title="${4:?}"

    local anchor
    anchor=$(_build_anchor "$req_id" "$req_title")
    echo "${repo_url}/blob/master/${markdown_path}#${anchor}"
}

# Build a markdown link to a specific phase in the document.
#
# Usage:
#   build_phase_link <repo_url> <markdown_path> <phase_id> <phase_name>
#
# Arguments:
#   repo_url       Base repo URL (e.g., https://github.com/owner/repo)
#   markdown_path  Path to the markdown file relative to repo root
#   phase_id       Phase identifier (e.g., PHASE-01)
#   phase_name     Phase name
#
# Output (stdout):
#   URL link to the phase section
build_phase_link() {
    local repo_url="${1:?Usage: build_phase_link <repo_url> <markdown_path> <phase_id> <phase_name>}"
    local markdown_path="${2:?}"
    local phase_id="${3:?}"
    local phase_name="${4:?}"

    local anchor
    anchor=$(_build_anchor "$phase_id" "$phase_name")
    echo "${repo_url}/blob/master/${markdown_path}#${anchor}"
}

# List all IDs (phases and requirements) found in the document.
#
# Usage:
#   list_all_ids <markdown_file>
#
# Arguments:
#   markdown_file  Path to the requirements markdown document
#
# Output (stdout):
#   One ID per line with type prefix:
#   phase:PHASE-01
#   req:REQ-001
#   req:REQ-002
#   ...
list_all_ids() {
    local markdown_file="${1:?Usage: list_all_ids <markdown_file>}"

    parse_phases "$markdown_file" 2>/dev/null | while IFS='|' read -r pid _rest; do
        echo "phase:${pid}"
    done

    parse_requirements "$markdown_file" 2>/dev/null | while IFS='|' read -r rid _rest; do
        echo "req:${rid}"
    done
}

# ============================================================================
# Link Expansion
# ============================================================================

# Expand internal markdown links to full GitHub URLs.
#
# Converts relative anchor links like [text](#anchor) to absolute links
# like [text](base_url#anchor). Already-absolute URLs are left unchanged.
#
# Usage:
#   expand_internal_links <text> <base_url>
#
# Arguments:
#   text      The markdown text containing internal links
#   base_url  Full URL to the markdown file (e.g.,
#             https://github.com/owner/repo/blob/master/docs/req.md)
#
# Output (stdout):
#   The text with internal links expanded to absolute URLs
expand_internal_links() {
    local text="$1"
    local base_url="$2"

    # Escape & in base_url for sed replacement safety
    local escaped_url="${base_url//&/\\&}"

    # Replace ](#anchor) with ](base_url#anchor)
    # Only matches relative anchor links (starting with #)
    echo "$text" | sed "s|](#\([^)]*\))|](${escaped_url}#\1)|g"
}

# ============================================================================
# Issue Tracking
# ============================================================================

# Get the existing GitHub issue number for an item from the markdown.
#
# Looks for a **GitHub Issue:** annotation line near the item's heading.
#
# Usage:
#   get_existing_issue <markdown_file> <item_id>
#
# Arguments:
#   markdown_file  Path to the requirements markdown document
#   item_id        Phase or requirement ID (e.g., PHASE-01, AUTH-003)
#
# Output (stdout):
#   The issue number if found
#
# Returns:
#   0 if an issue annotation was found, 1 otherwise
get_existing_issue() {
    local markdown_file="$1"
    local item_id="$2"

    if [ ! -f "$markdown_file" ]; then
        return 1
    fi

    local heading_pattern
    if [[ "$item_id" =~ ^PHASE-[0-9]+$ ]]; then
        heading_pattern="^### ${item_id}:"
    else
        heading_pattern="^#### ${item_id}:"
    fi

    local heading_line_num
    heading_line_num=$(grep -n "$heading_pattern" "$markdown_file" | head -1 | cut -d: -f1)

    if [ -z "$heading_line_num" ]; then
        return 1
    fi

    # Search up to 5 lines after the heading for **GitHub Issue:**
    local search_end=$((heading_line_num + 5))
    local issue_match
    issue_match=$(sed -n "${heading_line_num},${search_end}p" "$markdown_file" \
        | grep '\*\*GitHub Issue:\*\*' | head -1) || true

    if [ -z "$issue_match" ]; then
        return 1
    fi

    # Extract issue number from [#N](...) pattern
    local issue_num
    issue_num=$(echo "$issue_match" | grep -oE '#[0-9]+' | head -1 | tr -d '#') || true

    if [ -n "$issue_num" ]; then
        echo "$issue_num"
        return 0
    fi

    return 1
}

# Check if an item already has a GitHub issue annotation.
#
# Usage:
#   has_existing_issue <markdown_file> <item_id>
#
# Returns:
#   0 if the item has an existing issue, 1 otherwise
has_existing_issue() {
    get_existing_issue "$@" > /dev/null 2>&1
}

# Annotate an item's heading in the markdown with a GitHub issue link.
#
# Inserts a **GitHub Issue:** line after the item's heading. If an annotation
# already exists, it is updated in place.
#
# Usage:
#   annotate_issue <markdown_file> <item_id> <issue_num> <issue_url>
#
# Arguments:
#   markdown_file  Path to the requirements markdown document
#   item_id        Phase or requirement ID (e.g., PHASE-01, AUTH-003)
#   issue_num      The GitHub issue number
#   issue_url      Full URL to the issue (e.g., https://github.com/.../issues/5)
#
# Returns:
#   0 on success, 1 if heading not found
annotate_issue() {
    local markdown_file="$1"
    local item_id="$2"
    local issue_num="$3"
    local issue_url="$4"

    local heading_pattern
    if [[ "$item_id" =~ ^PHASE-[0-9]+$ ]]; then
        heading_pattern="^### ${item_id}:"
    else
        heading_pattern="^#### ${item_id}:"
    fi

    local heading_line_num
    heading_line_num=$(grep -n "$heading_pattern" "$markdown_file" | head -1 | cut -d: -f1)

    if [ -z "$heading_line_num" ]; then
        log_warn "Could not find heading for $item_id in $markdown_file"
        return 1
    fi

    local issue_text="**GitHub Issue:** [#${issue_num}](${issue_url})"

    # Check if there's already a GitHub Issue annotation near the heading
    local search_end=$((heading_line_num + 5))
    local existing_line_num
    existing_line_num=$(awk -v start="$heading_line_num" -v end="$search_end" \
        'NR >= start && NR <= end && /\*\*GitHub Issue:\*\*/ { print NR; exit }' \
        "$markdown_file") || true

    local tmpfile
    tmpfile=$(mktemp)

    if [ -n "$existing_line_num" ]; then
        # Update existing annotation in place
        awk -v target="$existing_line_num" -v issue="$issue_text" '
            NR == target { print issue; next }
            { print }
        ' "$markdown_file" > "$tmpfile"
    else
        # Insert new annotation after the heading (and any trailing blank line)
        awk -v hl="$heading_line_num" -v issue="$issue_text" '
            NR == hl { print; state = 1; next }
            state == 1 && /^[[:space:]]*$/ { print; print issue; print ""; state = 0; next }
            state == 1 { print ""; print issue; print ""; print; state = 0; next }
            { print }
            END { if (state == 1) { print ""; print issue; print "" } }
        ' "$markdown_file" > "$tmpfile"
    fi

    mv "$tmpfile" "$markdown_file"
}

# ============================================================================
# Document Validation
# ============================================================================

# Validate the structure and content of a requirements document.
#
# Checks for:
#   - Required sections (Vision, Requirements, Implementation Plan)
#   - Parseable requirements and phases
#   - Valid cross-references (requirement deps, phase prerequisites)
#   - Orphan requirements (not assigned to any phase)
#   - Existing issue annotations
#
# Usage:
#   validate_document <markdown_file>
#
# Arguments:
#   markdown_file  Path to the requirements markdown document
#
# Returns:
#   0 if validation passes (warnings are OK), 1 if errors found
validate_document() {
    local markdown_file="${1:?Usage: validate_document <markdown_file>}"

    if [ ! -f "$markdown_file" ]; then
        log_error "File not found: $markdown_file"
        return 1
    fi

    local errors=0
    local warnings=0

    # Check required sections
    if grep -qE '^##[[:space:]]+(1[\. ]|[Vv]ision)' "$markdown_file"; then
        log_info "CHECK: ✓ Vision section found"
    else
        log_error "CHECK: Missing Vision section (expected '## 1. Vision' or '## Vision')"
        ((errors++)) || true
    fi

    if grep -qE '^##[[:space:]]+(2[\. ]|[Rr]equirements)' "$markdown_file"; then
        log_info "CHECK: ✓ Requirements section found"
    else
        log_error "CHECK: Missing Requirements section (expected '## 2. Requirements' or '## Requirements')"
        ((errors++)) || true
    fi

    if grep -qE '^##[[:space:]]+(3[\. ]|[Ii]mplementation)' "$markdown_file"; then
        log_info "CHECK: ✓ Implementation Plan section found"
    else
        log_error "CHECK: Missing Implementation Plan section (expected '## 3. Implementation Plan' or '## Implementation Plan')"
        ((errors++)) || true
    fi

    # Parse requirements
    local req_count=0
    local -a all_req_ids=()
    while IFS='|' read -r req_id req_title req_area req_deps; do
        ((req_count++)) || true
        all_req_ids+=("$req_id")
        [ -z "$req_title" ] && { log_warn "CHECK: $req_id has no title"; ((warnings++)) || true; }
        [ -z "$req_area" ] && { log_warn "CHECK: $req_id has no functional area"; ((warnings++)) || true; }
    done < <(parse_requirements "$markdown_file" 2>/dev/null || true)

    log_info "CHECK: Found $req_count requirement(s)"

    # Parse phases
    local phase_count=0
    local -a all_phase_ids=()
    local -a phase_req_ids=()
    while IFS='|' read -r phase_id phase_name phase_goal phase_scope phase_prereqs phase_reqs; do
        ((phase_count++)) || true
        all_phase_ids+=("$phase_id")

        [ -z "$phase_name" ] && { log_warn "CHECK: $phase_id has no name"; ((warnings++)) || true; }
        [ -z "$phase_goal" ] && { log_warn "CHECK: $phase_id has no goal"; ((warnings++)) || true; }

        # Validate requirement references
        if [ -n "$phase_reqs" ]; then
            IFS=',' read -ra reqs <<< "$phase_reqs"
            for r in "${reqs[@]}"; do
                phase_req_ids+=("$r")
                local found_req=0
                for rid in "${all_req_ids[@]}"; do
                    [[ "$rid" == "$r" ]] && { found_req=1; break; }
                done
                if [[ $found_req -eq 0 ]]; then
                    log_error "CHECK: $phase_id references unknown requirement: $r"
                    ((errors++)) || true
                fi
            done
        fi
    done < <(parse_phases "$markdown_file" 2>/dev/null || true)

    log_info "CHECK: Found $phase_count phase(s)"

    # Check for orphan requirements
    for rid in "${all_req_ids[@]}"; do
        local in_phase=0
        for prid in "${phase_req_ids[@]+"${phase_req_ids[@]}"}"; do
            [[ "$prid" == "$rid" ]] && { in_phase=1; break; }
        done
        if [[ $in_phase -eq 0 ]]; then
            log_warn "CHECK: $rid is not assigned to any phase"
            ((warnings++)) || true
        fi
    done

    # Check for existing issue annotations
    local issued_count=0
    for id in "${all_phase_ids[@]}" "${all_req_ids[@]}"; do
        if has_existing_issue "$markdown_file" "$id"; then
            ((issued_count++)) || true
        fi
    done
    if [[ $issued_count -gt 0 ]]; then
        log_info "CHECK: $issued_count item(s) already have GitHub issues"
    fi

    # Summary
    echo ""
    if [[ $errors -gt 0 ]]; then
        log_error "CHECK: Validation FAILED — $errors error(s), $warnings warning(s)"
        return 1
    elif [[ $warnings -gt 0 ]]; then
        log_warn "CHECK: Validation passed with $warnings warning(s)"
        return 0
    else
        log_info "CHECK: Validation PASSED — $req_count requirement(s), $phase_count phase(s)"
        return 0
    fi
}

# ============================================================================
# Internal Helper Functions
# ============================================================================

# Emit a phase record as a pipe-delimited line.
_emit_phase() {
    local id="${1:-}"
    local name="${2:-}"
    local goal="${3:-}"
    local scope="${4:-}"
    local prereqs="${5:-}"
    local req_list="${6:-}"

    [ -z "$id" ] && return

    echo "${id}|${name}|${goal}|${scope}|${prereqs}|${req_list}"
}

# Emit a requirement record as a pipe-delimited line.
_emit_requirement() {
    local id="${1:-}"
    local title="${2:-}"
    local area="${3:-}"
    local deps="${4:-None}"

    [ -z "$id" ] && return

    echo "${id}|${title}|${area}|${deps}"
}

# Extract a single requirement ID from a line of text.
# Matches patterns like REQ-001, AUTH-003, PAY-012, etc.
_extract_req_id() {
    local line="$1"
    if [[ "$line" =~ ([A-Z]+-[0-9]+) ]]; then
        echo "${BASH_REMATCH[1]}"
    fi
}

# Extract all requirement IDs from a line of text.
# Returns comma-separated list.
_extract_all_req_ids() {
    local line="$1"
    local result=""

    # Use grep -o to get all matches
    local ids
    ids=$(echo "$line" | grep -oE '[A-Z]+-[0-9]+' || true)

    while IFS= read -r id; do
        [ -z "$id" ] && continue
        if [ -n "$result" ]; then
            result="${result},${id}"
        else
            result="$id"
        fi
    done <<< "$ids"

    echo "$result"
}

# Extract PHASE-nn references from a line of text.
# Returns comma-separated list, or "None" if none found.
_extract_phase_refs() {
    local line="$1"
    local result=""

    if [[ "$line" =~ ^[Nn]one ]] || [ -z "$line" ]; then
        echo "None"
        return
    fi

    local refs
    refs=$(echo "$line" | grep -oE 'PHASE-[0-9]+' || true)

    while IFS= read -r ref; do
        [ -z "$ref" ] && continue
        if [ -n "$result" ]; then
            result="${result},${ref}"
        else
            result="$ref"
        fi
    done <<< "$refs"

    if [ -z "$result" ]; then
        echo "None"
    else
        echo "$result"
    fi
}

# Build a GitHub-compatible anchor from an ID and title.
# GitHub lowercases, replaces spaces with hyphens, strips punctuation.
_build_anchor() {
    local id="$1"
    local title="$2"

    local combined="${id}: ${title}"
    # Lowercase
    combined="${combined,,}"
    # Replace spaces with hyphens
    combined="${combined// /-}"
    # Remove characters that aren't alphanumeric, hyphens, or underscores
    combined=$(echo "$combined" | sed 's/[^a-z0-9_-]//g')
    # Collapse multiple hyphens
    combined=$(echo "$combined" | sed 's/-\+/-/g')
    # Trim trailing hyphens
    combined="${combined%-}"

    echo "$combined"
}

# Export all public functions
export -f parse_phases
export -f parse_requirements
export -f get_phase_requirements
export -f get_requirement_detail
export -f get_phase_detail
export -f find_phase_for_requirement
export -f build_requirement_link
export -f build_phase_link
export -f list_all_ids
export -f expand_internal_links
export -f get_existing_issue
export -f has_existing_issue
export -f annotate_issue
export -f validate_document
