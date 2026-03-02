#!/usr/bin/env bats

# Test suite for requirements-parser.bash library
# Tests parsing of standardized requirements documents

load ../test_helper

# ============================================================================
# Setup / Teardown
# ============================================================================

setup() {
    test_helper_setup
    source "$DEVENV_TOOLS/lib/requirements-parser.bash"

    # Copy fixture to temp dir so tests have a known file
    FIXTURE_FILE="$DEVENV_TOOLS/tests/fixtures/sample-requirements.md"
    TEST_MD="$TEST_TEMP_DIR/requirements.md"
    cp "$FIXTURE_FILE" "$TEST_MD"
}

teardown() {
    test_helper_teardown
}

# ============================================================================
# Guard tests
# ============================================================================

@test "guard: library can be sourced" {
    source "$DEVENV_TOOLS/lib/requirements-parser.bash"
}

@test "guard: double-sourcing does not error" {
    source "$DEVENV_TOOLS/lib/requirements-parser.bash"
    source "$DEVENV_TOOLS/lib/requirements-parser.bash"
}

# ============================================================================
# parse_phases tests
# ============================================================================

@test "parse_phases: finds all three phases" {
    local output
    output=$(parse_phases "$TEST_MD")
    local count
    count=$(echo "$output" | wc -l)
    [[ $count -eq 3 ]]
}

@test "parse_phases: first phase has correct ID" {
    local output
    output=$(parse_phases "$TEST_MD" | head -1)
    [[ "$output" == *"PHASE-01|"* ]]
}

@test "parse_phases: first phase has correct name" {
    local output
    output=$(parse_phases "$TEST_MD" | head -1)
    local name
    name=$(echo "$output" | cut -d'|' -f2)
    [[ "$name" == "Foundation" ]]
}

@test "parse_phases: first phase has correct goal" {
    local output
    output=$(parse_phases "$TEST_MD" | head -1)
    local goal
    goal=$(echo "$output" | cut -d'|' -f3)
    [[ "$goal" == "Establish user registration and login as the base for all other features" ]]
}

@test "parse_phases: first phase has correct scope" {
    local output
    output=$(parse_phases "$TEST_MD" | head -1)
    local scope
    scope=$(echo "$output" | cut -d'|' -f4)
    [[ "$scope" == "Medium" ]]
}

@test "parse_phases: first phase has no prerequisites" {
    local output
    output=$(parse_phases "$TEST_MD" | head -1)
    local prereqs
    prereqs=$(echo "$output" | cut -d'|' -f5)
    [[ "$prereqs" == "None" ]]
}

@test "parse_phases: first phase has correct requirements" {
    local output
    output=$(parse_phases "$TEST_MD" | head -1)
    local reqs
    reqs=$(echo "$output" | cut -d'|' -f6)
    [[ "$reqs" == "AUTH-001,AUTH-002" ]]
}

@test "parse_phases: second phase has PHASE-01 as prerequisite" {
    local output
    output=$(parse_phases "$TEST_MD" | sed -n '2p')
    local prereqs
    prereqs=$(echo "$output" | cut -d'|' -f5)
    [[ "$prereqs" == "PHASE-01" ]]
}

@test "parse_phases: third phase has correct requirements" {
    local output
    output=$(parse_phases "$TEST_MD" | sed -n '3p')
    local reqs
    reqs=$(echo "$output" | cut -d'|' -f6)
    [[ "$reqs" == "SRCH-001,SRCH-002" ]]
}

@test "parse_phases: returns error for missing file" {
    run parse_phases "/nonexistent/file.md"
    [[ $status -ne 0 ]]
}

@test "parse_phases: returns error for file with no phases" {
    echo "# No phases here" > "$TEST_TEMP_DIR/empty.md"
    run parse_phases "$TEST_TEMP_DIR/empty.md"
    [[ $status -ne 0 ]]
}

# ============================================================================
# parse_requirements tests
# ============================================================================

@test "parse_requirements: finds all five requirements" {
    local output
    output=$(parse_requirements "$TEST_MD")
    local count
    count=$(echo "$output" | wc -l)
    [[ $count -eq 5 ]]
}

@test "parse_requirements: first requirement has correct ID" {
    local output
    output=$(parse_requirements "$TEST_MD" | head -1)
    [[ "$output" == "AUTH-001|"* ]]
}

@test "parse_requirements: first requirement has correct title" {
    local output
    output=$(parse_requirements "$TEST_MD" | head -1)
    local title
    title=$(echo "$output" | cut -d'|' -f2)
    [[ "$title" == "User Registration" ]]
}

@test "parse_requirements: first requirement has correct functional area" {
    local output
    output=$(parse_requirements "$TEST_MD" | head -1)
    local area
    area=$(echo "$output" | cut -d'|' -f3)
    [[ "$area" == "User Management" ]]
}

@test "parse_requirements: first requirement has no dependencies" {
    local output
    output=$(parse_requirements "$TEST_MD" | head -1)
    local deps
    deps=$(echo "$output" | cut -d'|' -f4)
    [[ "$deps" == "None" ]]
}

@test "parse_requirements: AUTH-002 depends on AUTH-001" {
    local output
    output=$(parse_requirements "$TEST_MD" | sed -n '2p')
    local deps
    deps=$(echo "$output" | cut -d'|' -f4)
    [[ "$deps" == "AUTH-001" ]]
}

@test "parse_requirements: AUTH-003 has multiple dependencies" {
    local output
    output=$(parse_requirements "$TEST_MD" | sed -n '3p')
    local deps
    deps=$(echo "$output" | cut -d'|' -f4)
    [[ "$deps" == "AUTH-001,AUTH-002" ]]
}

@test "parse_requirements: SRCH-001 is in Search functional area" {
    local output
    output=$(parse_requirements "$TEST_MD" | grep "^SRCH-001|")
    local area
    area=$(echo "$output" | cut -d'|' -f3)
    [[ "$area" == "Search" ]]
}

@test "parse_requirements: SRCH-002 depends on SRCH-001" {
    local output
    output=$(parse_requirements "$TEST_MD" | grep "^SRCH-002|")
    local deps
    deps=$(echo "$output" | cut -d'|' -f4)
    [[ "$deps" == "SRCH-001" ]]
}

@test "parse_requirements: returns error for missing file" {
    run parse_requirements "/nonexistent/file.md"
    [[ $status -ne 0 ]]
}

@test "parse_requirements: returns error for file with no requirements" {
    echo "# No requirements here" > "$TEST_TEMP_DIR/empty.md"
    run parse_requirements "$TEST_TEMP_DIR/empty.md"
    [[ $status -ne 0 ]]
}

# ============================================================================
# get_phase_requirements tests
# ============================================================================

@test "get_phase_requirements: returns requirements for PHASE-01" {
    local output
    output=$(get_phase_requirements "$TEST_MD" "PHASE-01")
    [[ "$output" == "AUTH-001,AUTH-002" ]]
}

@test "get_phase_requirements: returns requirements for PHASE-03" {
    local output
    output=$(get_phase_requirements "$TEST_MD" "PHASE-03")
    [[ "$output" == "SRCH-001,SRCH-002" ]]
}

@test "get_phase_requirements: fails for nonexistent phase" {
    run get_phase_requirements "$TEST_MD" "PHASE-99"
    [[ $status -ne 0 ]]
}

# ============================================================================
# get_requirement_detail tests
# ============================================================================

@test "get_requirement_detail: returns correct detail for AUTH-001" {
    local output
    output=$(get_requirement_detail "$TEST_MD" "AUTH-001")
    [[ "$output" == "AUTH-001|User Registration|User Management|None" ]]
}

@test "get_requirement_detail: returns correct detail for SRCH-002" {
    local output
    output=$(get_requirement_detail "$TEST_MD" "SRCH-002")
    local title
    title=$(echo "$output" | cut -d'|' -f2)
    [[ "$title" == "Advanced Search Filters" ]]
}

@test "get_requirement_detail: fails for nonexistent requirement" {
    run get_requirement_detail "$TEST_MD" "FAKE-999"
    [[ $status -ne 0 ]]
}

# ============================================================================
# get_phase_detail tests
# ============================================================================

@test "get_phase_detail: returns correct detail for PHASE-02" {
    local output
    output=$(get_phase_detail "$TEST_MD" "PHASE-02")
    local name
    name=$(echo "$output" | cut -d'|' -f2)
    [[ "$name" == "Extended Auth" ]]
}

@test "get_phase_detail: fails for nonexistent phase" {
    run get_phase_detail "$TEST_MD" "PHASE-99"
    [[ $status -ne 0 ]]
}

# ============================================================================
# find_phase_for_requirement tests
# ============================================================================

@test "find_phase_for_requirement: AUTH-001 is in PHASE-01" {
    local output
    output=$(find_phase_for_requirement "$TEST_MD" "AUTH-001")
    [[ "$output" == "PHASE-01" ]]
}

@test "find_phase_for_requirement: AUTH-003 is in PHASE-02" {
    local output
    output=$(find_phase_for_requirement "$TEST_MD" "AUTH-003")
    [[ "$output" == "PHASE-02" ]]
}

@test "find_phase_for_requirement: SRCH-001 is in PHASE-03" {
    local output
    output=$(find_phase_for_requirement "$TEST_MD" "SRCH-001")
    [[ "$output" == "PHASE-03" ]]
}

@test "find_phase_for_requirement: fails for unassigned requirement" {
    run find_phase_for_requirement "$TEST_MD" "FAKE-999"
    [[ $status -ne 0 ]]
}

# ============================================================================
# build_requirement_link tests
# ============================================================================

@test "build_requirement_link: produces correct URL" {
    local output
    output=$(build_requirement_link "https://github.com/org/repo" "docs/requirements.md" "AUTH-001" "User Registration")
    [[ "$output" == "https://github.com/org/repo/blob/master/docs/requirements.md#auth-001-user-registration" ]]
}

# ============================================================================
# build_phase_link tests
# ============================================================================

@test "build_phase_link: produces correct URL" {
    local output
    output=$(build_phase_link "https://github.com/org/repo" "docs/requirements.md" "PHASE-01" "Foundation")
    [[ "$output" == "https://github.com/org/repo/blob/master/docs/requirements.md#phase-01-foundation" ]]
}

# ============================================================================
# list_all_ids tests
# ============================================================================

@test "list_all_ids: lists phases first then requirements" {
    local output
    output=$(list_all_ids "$TEST_MD")
    local first
    first=$(echo "$output" | head -1)
    [[ "$first" == "phase:PHASE-01" ]]
}

@test "list_all_ids: lists all 8 items (3 phases + 5 requirements)" {
    local output
    output=$(list_all_ids "$TEST_MD")
    local count
    count=$(echo "$output" | wc -l)
    [[ $count -eq 8 ]]
}

@test "list_all_ids: contains req:SRCH-002" {
    local output
    output=$(list_all_ids "$TEST_MD")
    echo "$output" | grep -q "req:SRCH-002"
}

# ============================================================================
# _build_anchor tests
# ============================================================================

@test "_build_anchor: produces correct GitHub-style anchor" {
    local output
    output=$(_build_anchor "AUTH-001" "User Registration")
    [[ "$output" == "auth-001-user-registration" ]]
}

@test "_build_anchor: handles special characters" {
    local output
    output=$(_build_anchor "PHASE-01" "Foundation — Core Auth")
    # em dash is stripped, surrounding spaces become hyphens, then collapsed
    [[ "$output" == "phase-01-foundation-core-auth" ]]
}

# ============================================================================
# _extract_req_id tests
# ============================================================================

@test "_extract_req_id: extracts ID from bullet line" {
    local output
    output=$(_extract_req_id "- [AUTH-001: User Registration](#auth-001-user-registration)")
    [[ "$output" == "AUTH-001" ]]
}

@test "_extract_req_id: extracts ID from plain text" {
    local output
    output=$(_extract_req_id "Depends on REQ-042 being complete")
    [[ "$output" == "REQ-042" ]]
}

@test "_extract_req_id: returns empty for line with no ID" {
    local output
    output=$(_extract_req_id "Just a plain line with no IDs")
    [[ -z "$output" ]]
}

# ============================================================================
# _extract_all_req_ids tests
# ============================================================================

@test "_extract_all_req_ids: extracts multiple IDs" {
    local output
    output=$(_extract_all_req_ids "[AUTH-001](#a), [AUTH-002](#b)")
    [[ "$output" == "AUTH-001,AUTH-002" ]]
}

@test "_extract_all_req_ids: extracts single ID" {
    local output
    output=$(_extract_all_req_ids "[REQ-005](#req-005)")
    [[ "$output" == "REQ-005" ]]
}

@test "_extract_all_req_ids: returns empty for no IDs" {
    local output
    output=$(_extract_all_req_ids "No IDs here")
    [[ -z "$output" ]]
}

# ============================================================================
# _extract_phase_refs tests
# ============================================================================

@test "_extract_phase_refs: extracts single phase reference" {
    local output
    output=$(_extract_phase_refs "[PHASE-01](#phase-01-foundation)")
    [[ "$output" == "PHASE-01" ]]
}

@test "_extract_phase_refs: extracts multiple phase references" {
    local output
    output=$(_extract_phase_refs "[PHASE-01](#a), [PHASE-02](#b)")
    [[ "$output" == "PHASE-01,PHASE-02" ]]
}

@test "_extract_phase_refs: returns None for 'None'" {
    local output
    output=$(_extract_phase_refs "None")
    [[ "$output" == "None" ]]
}

@test "_extract_phase_refs: returns None for empty string" {
    local output
    output=$(_extract_phase_refs "")
    [[ "$output" == "None" ]]
}

# ============================================================================
# Edge case: REQ- prefix (small project)
# ============================================================================

@test "parse_requirements: handles REQ- prefix" {
    cat > "$TEST_TEMP_DIR/small-project.md" << 'HEREDOC'
## 2. Requirements

### 2.1 Core Features

#### REQ-001: Widget Creation

**Description:** Users can create widgets.

**Acceptance Criteria:**
- Widgets are persisted

**Dependencies:** None

---

#### REQ-002: Widget Editing

**Description:** Users can edit widgets.

**Acceptance Criteria:**
- Changes are saved

**Dependencies:** [REQ-001](#req-001-widget-creation)

---
HEREDOC

    local output
    output=$(parse_requirements "$TEST_TEMP_DIR/small-project.md")
    local count
    count=$(echo "$output" | wc -l)
    [[ $count -eq 2 ]]

    local first_id
    first_id=$(echo "$output" | head -1 | cut -d'|' -f1)
    [[ "$first_id" == "REQ-001" ]]

    local second_deps
    second_deps=$(echo "$output" | sed -n '2p' | cut -d'|' -f4)
    [[ "$second_deps" == "REQ-001" ]]
}

# ============================================================================
# Edge case: missing trailing ---
# ============================================================================

@test "parse_requirements: handles missing trailing horizontal rule" {
    cat > "$TEST_TEMP_DIR/no-trailing-hr.md" << 'HEREDOC'
## 2. Requirements

### 2.1 Core

#### REQ-001: First

**Description:** Something.

**Acceptance Criteria:**
- Done

**Dependencies:** None
HEREDOC

    local output
    output=$(parse_requirements "$TEST_TEMP_DIR/no-trailing-hr.md")
    local count
    count=$(echo "$output" | wc -l)
    [[ $count -eq 1 ]]
}

@test "parse_phases: handles missing trailing horizontal rule" {
    cat > "$TEST_TEMP_DIR/no-trailing-hr-phase.md" << 'HEREDOC'
## 3. Implementation Plan

### PHASE-01: Only Phase — The Only One

**Goal:** Do the thing

**Requirements Included:**
- [REQ-001: First](#req-001-first)

**Prerequisites:** None

**Scope:** Small

**Rationale:** It's the only phase
HEREDOC

    local output
    output=$(parse_phases "$TEST_TEMP_DIR/no-trailing-hr-phase.md")
    local count
    count=$(echo "$output" | wc -l)
    [[ $count -eq 1 ]]
    [[ "$output" == "PHASE-01|"* ]]
}

# ============================================================================
# expand_internal_links tests
# ============================================================================

@test "expand_internal_links: expands relative anchor links" {
    local result
    result=$(expand_internal_links "See [AUTH-001](#auth-001-user-reg)" "https://github.com/org/repo/blob/main/docs/req.md")
    [[ "$result" == "See [AUTH-001](https://github.com/org/repo/blob/main/docs/req.md#auth-001-user-reg)" ]]
}

@test "expand_internal_links: preserves absolute URL links" {
    local result
    result=$(expand_internal_links "See [docs](https://example.com)" "https://github.com/org/repo/blob/main/docs/req.md")
    [[ "$result" == "See [docs](https://example.com)" ]]
}

@test "expand_internal_links: handles multiple links in text" {
    local result
    result=$(expand_internal_links "[A](#a) and [B](#b)" "https://example.com/file.md")
    [[ "$result" == "[A](https://example.com/file.md#a) and [B](https://example.com/file.md#b)" ]]
}

@test "expand_internal_links: returns unchanged text with no links" {
    local result
    result=$(expand_internal_links "No links here" "https://example.com/file.md")
    [[ "$result" == "No links here" ]]
}

@test "expand_internal_links: does not expand non-anchor relative links" {
    local result
    result=$(expand_internal_links "[other](other-file.md)" "https://example.com/file.md")
    [[ "$result" == "[other](other-file.md)" ]]
}

# ============================================================================
# get_existing_issue tests
# ============================================================================

@test "get_existing_issue: returns issue number when annotation present" {
    cat > "$TEST_TEMP_DIR/annotated.md" << 'HEREDOC'
## 2. Requirements

### 2.1 Core

#### AUTH-001: User Registration

**GitHub Issue:** [#42](https://github.com/org/repo/issues/42)

**Description:** Something.

**Dependencies:** None

---
HEREDOC

    local result
    result=$(get_existing_issue "$TEST_TEMP_DIR/annotated.md" "AUTH-001")
    [[ "$result" == "42" ]]
}

@test "get_existing_issue: returns 1 when no annotation present" {
    run get_existing_issue "$TEST_MD" "AUTH-001"
    [[ $status -eq 1 ]]
}

@test "get_existing_issue: works with phase headings" {
    cat > "$TEST_TEMP_DIR/annotated-phase.md" << 'HEREDOC'
## 3. Implementation Plan

### PHASE-01: Foundation — Core Auth

**GitHub Issue:** [#10](https://github.com/org/repo/issues/10)

**Goal:** Do the thing

**Requirements Included:**

- [AUTH-001: First](#auth-001-first)

**Prerequisites:** None

**Scope:** Small
HEREDOC

    local result
    result=$(get_existing_issue "$TEST_TEMP_DIR/annotated-phase.md" "PHASE-01")
    [[ "$result" == "10" ]]
}

@test "get_existing_issue: returns 1 for unknown item" {
    run get_existing_issue "$TEST_MD" "NONEXIST-999"
    [[ $status -eq 1 ]]
}

# ============================================================================
# has_existing_issue tests
# ============================================================================

@test "has_existing_issue: returns 0 when issue exists" {
    cat > "$TEST_TEMP_DIR/annotated.md" << 'HEREDOC'
## 2. Requirements

### 2.1 Core

#### REQ-001: Widget

**GitHub Issue:** [#7](https://github.com/org/repo/issues/7)

**Description:** A widget.

**Dependencies:** None
HEREDOC

    has_existing_issue "$TEST_TEMP_DIR/annotated.md" "REQ-001"
}

@test "has_existing_issue: returns 1 when no issue" {
    ! has_existing_issue "$TEST_MD" "AUTH-001"
}

# ============================================================================
# annotate_issue tests
# ============================================================================

@test "annotate_issue: inserts issue link after heading with blank line" {
    local test_file="$TEST_TEMP_DIR/annotate-test.md"
    cp "$TEST_MD" "$test_file"

    annotate_issue "$test_file" "AUTH-001" "42" "https://github.com/org/repo/issues/42"

    # Verify the annotation was added
    grep -q '^\*\*GitHub Issue:\*\* \[#42\]' "$test_file"
}

@test "annotate_issue: issue link appears near the heading" {
    local test_file="$TEST_TEMP_DIR/annotate-test2.md"
    cp "$TEST_MD" "$test_file"

    annotate_issue "$test_file" "AUTH-002" "99" "https://github.com/org/repo/issues/99"

    # The annotation should appear within 3 lines of the heading
    local heading_line
    heading_line=$(grep -n "#### AUTH-002:" "$test_file" | head -1 | cut -d: -f1)
    local issue_line
    issue_line=$(grep -n 'GitHub Issue.*#99' "$test_file" | head -1 | cut -d: -f1)
    local diff=$((issue_line - heading_line))
    [[ $diff -le 3 ]]
}

@test "annotate_issue: updates existing annotation in place" {
    local test_file="$TEST_TEMP_DIR/annotate-update.md"
    cp "$TEST_MD" "$test_file"

    # First annotation
    annotate_issue "$test_file" "AUTH-001" "42" "https://github.com/org/repo/issues/42"
    grep -q '#42' "$test_file"

    # Update annotation
    annotate_issue "$test_file" "AUTH-001" "99" "https://github.com/org/repo/issues/99"
    grep -q '#99' "$test_file"
    # Old annotation should be gone
    ! grep -q '#42' "$test_file"
}

@test "annotate_issue: works with phase headings" {
    local test_file="$TEST_TEMP_DIR/annotate-phase.md"
    cp "$TEST_MD" "$test_file"

    annotate_issue "$test_file" "PHASE-01" "5" "https://github.com/org/repo/issues/5"

    grep -q '^\*\*GitHub Issue:\*\* \[#5\]' "$test_file"
}

@test "annotate_issue: does not break parsing after annotation" {
    local test_file="$TEST_TEMP_DIR/annotate-parse.md"
    cp "$TEST_MD" "$test_file"

    # Annotate multiple items
    annotate_issue "$test_file" "AUTH-001" "1" "https://github.com/org/repo/issues/1"
    annotate_issue "$test_file" "PHASE-01" "2" "https://github.com/org/repo/issues/2"

    # Parser should still find all requirements and phases
    local req_count
    req_count=$(parse_requirements "$test_file" | wc -l)
    [[ $req_count -eq 5 ]]

    local phase_count
    phase_count=$(parse_phases "$test_file" | wc -l)
    [[ $phase_count -eq 3 ]]
}

@test "annotate_issue: returns 1 for nonexistent item" {
    local test_file="$TEST_TEMP_DIR/annotate-missing.md"
    cp "$TEST_MD" "$test_file"

    run annotate_issue "$test_file" "NONEXIST-999" "1" "https://github.com/org/repo/issues/1"
    [[ $status -eq 1 ]]
}

# ============================================================================
# validate_document tests
# ============================================================================

@test "validate_document: passes for valid document" {
    run validate_document "$TEST_MD"
    [[ $status -eq 0 ]]
    [[ "$output" == *"Validation PASSED"* ]]
}

@test "validate_document: reports missing sections" {
    cat > "$TEST_TEMP_DIR/missing-sections.md" << 'HEREDOC'
# Incomplete Doc

## 1. Vision

Some vision content.
HEREDOC

    run validate_document "$TEST_TEMP_DIR/missing-sections.md"
    [[ $status -eq 1 ]]
    [[ "$output" == *"Missing Requirements section"* ]]
    [[ "$output" == *"Missing Implementation Plan section"* ]]
}

@test "validate_document: reports orphan requirements" {
    cat > "$TEST_TEMP_DIR/orphans.md" << 'HEREDOC'
## 1. Vision

Content.

## 2. Requirements

### 2.1 Core

#### REQ-001: Widget

**Description:** A widget.

**Dependencies:** None

---

#### REQ-002: Gadget

**Description:** A gadget.

**Dependencies:** None

---

## 3. Implementation Plan

### PHASE-01: First — Do first things

**Goal:** Start

**Requirements:**

- [REQ-001: Widget](#req-001-widget)

**Prerequisites:** None

**Scope:** Small
HEREDOC

    run validate_document "$TEST_TEMP_DIR/orphans.md"
    [[ $status -eq 0 ]]
    [[ "$output" == *"REQ-002 is not assigned to any phase"* ]]
}

@test "validate_document: reports unknown requirement references in phases" {
    cat > "$TEST_TEMP_DIR/bad-refs.md" << 'HEREDOC'
## 1. Vision

Content.

## 2. Requirements

### 2.1 Core

#### REQ-001: Widget

**Description:** A widget.

**Dependencies:** None

---

## 3. Implementation Plan

### PHASE-01: First — Do first things

**Goal:** Start

**Requirements Included:**

- [REQ-001: Widget](#req-001-widget)
- [REQ-999: Ghost](#req-999-ghost)

**Prerequisites:** None

**Scope:** Small
HEREDOC

    run validate_document "$TEST_TEMP_DIR/bad-refs.md"
    [[ $status -eq 1 ]]
    [[ "$output" == *"references unknown requirement: REQ-999"* ]]
}

@test "validate_document: detects existing issue annotations" {
    local test_file="$TEST_TEMP_DIR/with-issues.md"
    cp "$TEST_MD" "$test_file"
    annotate_issue "$test_file" "AUTH-001" "42" "https://github.com/org/repo/issues/42"

    run validate_document "$test_file"
    [[ $status -eq 0 ]]
    [[ "$output" == *"1 item(s) already have GitHub issues"* ]]
}

# ============================================================================
# Hardening tests
# ============================================================================

@test "hardening: parses document with CRLF line endings" {
    # Convert the fixture to CRLF
    sed 's/$/\r/' "$TEST_MD" > "$TEST_TEMP_DIR/crlf.md"

    local req_count
    req_count=$(parse_requirements "$TEST_TEMP_DIR/crlf.md" | wc -l)
    [[ $req_count -eq 5 ]]

    local phase_count
    phase_count=$(parse_phases "$TEST_TEMP_DIR/crlf.md" | wc -l)
    [[ $phase_count -eq 3 ]]
}

@test "hardening: handles **Requirements:** without 'Included'" {
    cat > "$TEST_TEMP_DIR/short-label.md" << 'HEREDOC'
## 3. Implementation Plan

### PHASE-01: Only Phase — The Only One

**Goal:** Do the thing

**Requirements:**

- [REQ-001: First](#req-001-first)

**Prerequisites:** None

**Scope:** Small
HEREDOC

    local output
    output=$(parse_phases "$TEST_TEMP_DIR/short-label.md" | head -1)
    local reqs
    reqs=$(echo "$output" | cut -d'|' -f6)
    [[ "$reqs" == "REQ-001" ]]
}

@test "hardening: handles **Prerequisite:** (singular)" {
    cat > "$TEST_TEMP_DIR/singular-prereq.md" << 'HEREDOC'
## 3. Implementation Plan

### PHASE-01: First — Start here

**Goal:** Begin

**Requirements Included:**

- [REQ-001: Start](#req-001-start)

**Prerequisite:** None

**Scope:** Small

---

### PHASE-02: Second — Continue

**Goal:** Continue

**Requirements Included:**

- [REQ-002: Next](#req-002-next)

**Prerequisite:** [PHASE-01](#phase-01-first--start-here)

**Scope:** Medium
HEREDOC

    local output
    output=$(parse_phases "$TEST_TEMP_DIR/singular-prereq.md" | sed -n '2p')
    local prereqs
    prereqs=$(echo "$output" | cut -d'|' -f5)
    [[ "$prereqs" == "PHASE-01" ]]
}

@test "hardening: handles ## Implementation Plan (no number)" {
    cat > "$TEST_TEMP_DIR/no-number.md" << 'HEREDOC'
## Implementation Plan

### PHASE-01: Only Phase — The Only One

**Goal:** Do the thing

**Requirements Included:**

- [REQ-001: First](#req-001-first)

**Prerequisites:** None

**Scope:** Small
HEREDOC

    local output
    output=$(parse_phases "$TEST_TEMP_DIR/no-number.md")
    local count
    count=$(echo "$output" | wc -l)
    [[ $count -eq 1 ]]
    [[ "$output" == "PHASE-01|"* ]]
}

@test "hardening: handles ## Requirements (no number)" {
    cat > "$TEST_TEMP_DIR/no-number-req.md" << 'HEREDOC'
## Requirements

### Core

#### REQ-001: Widget

**Description:** A widget.

**Dependencies:** None

---
HEREDOC

    local output
    output=$(parse_requirements "$TEST_TEMP_DIR/no-number-req.md")
    [[ "$output" == "REQ-001|Widget|Core|None" ]]
}
