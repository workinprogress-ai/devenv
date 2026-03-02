#!/usr/bin/env bats

# Test suite for planning-create-issues.sh script
# Tests argument parsing, issue orchestration, and dry-run behavior
# Uses a mock issue-create command to avoid real GitHub API calls

load ../test_helper

# ============================================================================
# Setup / Teardown
# ============================================================================

setup() {
    test_helper_setup

    SCRIPT="$DEVENV_TOOLS/scripts/planning-create-issues.sh"
    FIXTURE_FILE="$DEVENV_TOOLS/tests/fixtures/sample-requirements.md"
    TEST_MD="$TEST_TEMP_DIR/requirements.md"
    cp "$FIXTURE_FILE" "$TEST_MD"

    # Create a mock git repo so setup_repo_context works
    create_mock_git_repo "$TEST_TEMP_DIR/repo"
    cd "$TEST_TEMP_DIR/repo" || return 1

    # Place the markdown file inside the mock repo
    cp "$FIXTURE_FILE" "$TEST_TEMP_DIR/repo/docs-requirements.md"
    TEST_REPO_MD="$TEST_TEMP_DIR/repo/docs-requirements.md"

    # Create mock issue-create that records calls and returns fake issue numbers
    MOCK_LOG="$TEST_TEMP_DIR/issue-create-calls.log"
    MOCK_ISSUE_COUNTER_FILE="$TEST_TEMP_DIR/issue-counter"
    echo "0" > "$MOCK_ISSUE_COUNTER_FILE"

    mkdir -p "$TEST_TEMP_DIR/mock-bin"
    MOCK_BODY_DIR="$TEST_TEMP_DIR/mock-bodies"
    mkdir -p "$MOCK_BODY_DIR"
    cat > "$TEST_TEMP_DIR/mock-bin/issue-create" << 'MOCK_SCRIPT'
#!/bin/bash
# Mock issue-create: logs arguments and returns a fake issue URL
MOCK_LOG="${MOCK_LOG:-/tmp/issue-create-calls.log}"
MOCK_ISSUE_COUNTER_FILE="${MOCK_ISSUE_COUNTER_FILE:-/tmp/issue-counter}"
MOCK_BODY_DIR="${MOCK_BODY_DIR:-/tmp/mock-bodies}"

# Increment counter atomically
counter=$(cat "$MOCK_ISSUE_COUNTER_FILE")
counter=$((counter + 1))
echo "$counter" > "$MOCK_ISSUE_COUNTER_FILE"

# Log the call
echo "CALL $counter: $*" >> "$MOCK_LOG"

# Save body file if present
while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--body-file" ]] && [ -f "$2" ]; then
        cp "$2" "$MOCK_BODY_DIR/body-${counter}.md"
        break
    fi
    shift
done

# Output a fake issue URL (like gh would)
echo "https://github.com/test-org/dummy/issues/$counter"
MOCK_SCRIPT
    chmod +x "$TEST_TEMP_DIR/mock-bin/issue-create"

    # Export so the mock and script can find each other
    export MOCK_LOG
    export MOCK_ISSUE_COUNTER_FILE
    export MOCK_BODY_DIR
    export PATH="$TEST_TEMP_DIR/mock-bin:$PATH"

    # Set GITHUB_REPO to bypass gh CLI repo detection
    export GITHUB_REPO="test-org/dummy"
}

teardown() {
    test_helper_teardown
}

# Helper to run the script with common args
run_script() {
    cd "$TEST_TEMP_DIR/repo" || return 1
    bash "$SCRIPT" "$@"
}

# ============================================================================
# Argument validation tests
# ============================================================================

@test "script: --help shows usage" {
    run run_script --help
    [[ $status -eq 0 ]]
    [[ "$output" == *"Usage:"* ]]
}

@test "script: --version shows version" {
    run run_script --version
    [[ $status -eq 0 ]]
    [[ "$output" == *"version"* ]]
}

@test "script: fails without --markdown" {
    run run_script --all
    [[ $status -ne 0 ]]
    [[ "$output" == *"--markdown"* ]]
}

@test "script: fails without selection method" {
    run run_script --markdown "$TEST_REPO_MD"
    [[ $status -ne 0 ]]
    [[ "$output" == *"No items selected"* ]]
}

@test "script: fails with --all and specific IDs" {
    run run_script --markdown "$TEST_REPO_MD" --all PHASE-01
    [[ $status -ne 0 ]]
    [[ "$output" == *"Cannot use --all with specific IDs"* ]]
}

@test "script: fails with --all and --interactive" {
    run run_script --markdown "$TEST_REPO_MD" --all --interactive
    [[ $status -ne 0 ]]
    [[ "$output" == *"Cannot use --interactive with --all"* ]]
}

@test "script: fails with nonexistent markdown file" {
    run run_script --markdown "/nonexistent/file.md" --all
    [[ $status -ne 0 ]]
}

# ============================================================================
# Dry run tests
# ============================================================================

@test "dry-run: --all creates correct number of items" {
    run run_script --markdown "$TEST_REPO_MD" --all --dry-run
    [[ $status -eq 0 ]]
    # 3 phases + 5 requirements = 8 items
    local dry_run_count
    dry_run_count=$(echo "$output" | grep -c "\[DRY RUN\].*=>")
    [[ $dry_run_count -eq 8 ]]
}

@test "dry-run: phases are created as Epic" {
    run run_script --markdown "$TEST_REPO_MD" --all --dry-run
    [[ $status -eq 0 ]]
    [[ "$output" == *"PHASE-01 => Epic"* ]]
    [[ "$output" == *"PHASE-02 => Epic"* ]]
    [[ "$output" == *"PHASE-03 => Epic"* ]]
}

@test "dry-run: requirements are created as Feature" {
    run run_script --markdown "$TEST_REPO_MD" --all --dry-run
    [[ $status -eq 0 ]]
    [[ "$output" == *"AUTH-001 => Feature"* ]]
    [[ "$output" == *"SRCH-002 => Feature"* ]]
}

@test "dry-run: single phase shows phase and its requirements" {
    run run_script --markdown "$TEST_REPO_MD" --dry-run PHASE-01
    [[ $status -eq 0 ]]
    [[ "$output" == *"PHASE-01 => Epic"* ]]
    [[ "$output" == *"AUTH-001 => Feature"* ]]
    [[ "$output" == *"AUTH-002 => Feature"* ]]
}

@test "dry-run: single requirement also creates its parent phase" {
    run run_script --markdown "$TEST_REPO_MD" --dry-run AUTH-003
    [[ $status -eq 0 ]]
    [[ "$output" == *"PHASE-02 => Epic"* ]]
    [[ "$output" == *"AUTH-003 => Feature"* ]]
}

@test "dry-run: with --project shows project info" {
    run run_script --markdown "$TEST_REPO_MD" --dry-run PHASE-01 --project "Q2 2026"
    [[ $status -eq 0 ]]
    [[ "$output" == *"Project: Q2 2026"* ]]
}

@test "dry-run: with --milestone shows milestone info" {
    run run_script --markdown "$TEST_REPO_MD" --dry-run PHASE-01 --milestone "Sprint 1"
    [[ $status -eq 0 ]]
    [[ "$output" == *"Milestone: Sprint 1"* ]]
}

# ============================================================================
# Mock issue-create integration tests
# ============================================================================

@test "create: single phase calls issue-create with correct type" {
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    [[ -f "$MOCK_LOG" ]]
    # First call should be the phase epic
    local first_call
    first_call=$(head -1 "$MOCK_LOG")
    [[ "$first_call" == *"--type"*"Epic"* ]]
}

@test "create: single phase creates epic and its features" {
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    local call_count
    call_count=$(wc -l < "$MOCK_LOG")
    # PHASE-01 + AUTH-001 + AUTH-002 = 3 calls
    [[ $call_count -eq 3 ]]
}

@test "create: requirement issues use Feature type" {
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    # The second call (AUTH-001) should be Feature type
    local second_call
    second_call=$(sed -n '2p' "$MOCK_LOG")
    [[ "$second_call" == *"--type"*"Feature"* ]]
}

@test "create: requirement issues have --parent linking to phase" {
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    # The phase gets issue #1, so requirements should have --parent 1
    local second_call
    second_call=$(sed -n '2p' "$MOCK_LOG")
    [[ "$second_call" == *"--parent"*"1"* ]]
}

@test "create: --all creates all 8 issues" {
    run_script --markdown "$TEST_REPO_MD" --all
    local call_count
    call_count=$(wc -l < "$MOCK_LOG")
    [[ $call_count -eq 8 ]]
}

@test "create: phases are created before their requirements" {
    run_script --markdown "$TEST_REPO_MD" --all

    # Find the call number for PHASE-01 and AUTH-001
    local phase_call
    phase_call=$(grep "PHASE-01:" "$MOCK_LOG" | head -1 | grep -oE "^CALL [0-9]+" | grep -oE "[0-9]+")
    local req_call
    req_call=$(grep "AUTH-001:" "$MOCK_LOG" | head -1 | grep -oE "^CALL [0-9]+" | grep -oE "[0-9]+")

    [[ $phase_call -lt $req_call ]]
}

@test "create: issue titles include ID and name" {
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    local first_call
    first_call=$(head -1 "$MOCK_LOG")
    [[ "$first_call" == *"PHASE-01: Foundation"* ]]
}

@test "create: --no-template and --no-interactive flags are passed" {
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    local first_call
    first_call=$(head -1 "$MOCK_LOG")
    [[ "$first_call" == *"--no-template"* ]]
    [[ "$first_call" == *"--no-interactive"* ]]
}

@test "create: project flag is passed through" {
    run_script --markdown "$TEST_REPO_MD" PHASE-01 --project "My Project"
    local first_call
    first_call=$(head -1 "$MOCK_LOG")
    [[ "$first_call" == *"--project"*"My Project"* ]]
}

@test "create: milestone flag is passed through" {
    run_script --markdown "$TEST_REPO_MD" PHASE-01 --milestone "Sprint 3"
    local first_call
    first_call=$(head -1 "$MOCK_LOG")
    [[ "$first_call" == *"--milestone"*"Sprint 3"* ]]
}

@test "create: issue body references requirements document" {
    run_script --markdown "$TEST_REPO_MD" PHASE-01

    # The issue-create should have --body-file pointing to a temp file
    local first_call
    first_call=$(head -1 "$MOCK_LOG")
    [[ "$first_call" == *"--body-file"* ]]
}

# ============================================================================
# ID resolution tests
# ============================================================================

@test "resolve: specifying PHASE-01 includes its requirements" {
    run run_script --markdown "$TEST_REPO_MD" --dry-run PHASE-01
    [[ "$output" == *"AUTH-001"* ]]
    [[ "$output" == *"AUTH-002"* ]]
}

@test "resolve: specifying requirement includes its parent phase" {
    run run_script --markdown "$TEST_REPO_MD" --dry-run SRCH-001
    [[ "$output" == *"PHASE-03"* ]]
    [[ "$output" == *"SRCH-001"* ]]
}

@test "resolve: specifying multiple requirements deduplicates parent phase" {
    run run_script --markdown "$TEST_REPO_MD" --dry-run SRCH-001 SRCH-002
    [[ $status -eq 0 ]]
    # Should have 1 phase + 2 requirements = 3 items
    local item_count
    item_count=$(echo "$output" | grep -c "\[DRY RUN\].*=>")
    [[ $item_count -eq 3 ]]
}

@test "resolve: unrecognized ID format is warned and skipped" {
    run run_script --markdown "$TEST_REPO_MD" --dry-run PHASE-01 bad-id
    [[ "$output" == *"Unrecognized ID format"* ]]
}

# ============================================================================
# --no-expand tests
# ============================================================================

@test "no-expand: dry-run single phase creates only the epic" {
    run run_script --markdown "$TEST_REPO_MD" --dry-run --no-expand PHASE-01
    [[ $status -eq 0 ]]
    [[ "$output" == *"PHASE-01 => Epic"* ]]
    [[ "$output" != *"AUTH-001"* ]]
    [[ "$output" != *"AUTH-002"* ]]
    local item_count
    item_count=$(echo "$output" | grep -c "\[DRY RUN\].*=>")
    [[ $item_count -eq 1 ]]
}

@test "no-expand: create single phase calls issue-create once" {
    run_script --markdown "$TEST_REPO_MD" --no-expand PHASE-01
    local call_count
    call_count=$(wc -l < "$MOCK_LOG")
    [[ $call_count -eq 1 ]]
}

@test "no-expand: multiple phases creates only those epics" {
    run run_script --markdown "$TEST_REPO_MD" --dry-run --no-expand PHASE-01 PHASE-02
    [[ $status -eq 0 ]]
    [[ "$output" == *"PHASE-01 => Epic"* ]]
    [[ "$output" == *"PHASE-02 => Epic"* ]]
    local item_count
    item_count=$(echo "$output" | grep -c "\[DRY RUN\].*=>")
    [[ $item_count -eq 2 ]]
}

@test "no-expand: requirement still includes its parent phase" {
    run run_script --markdown "$TEST_REPO_MD" --dry-run --no-expand AUTH-003
    [[ $status -eq 0 ]]
    [[ "$output" == *"PHASE-02 => Epic"* ]]
    [[ "$output" == *"AUTH-003 => Feature"* ]]
    local item_count
    item_count=$(echo "$output" | grep -c "\[DRY RUN\].*=>")
    [[ $item_count -eq 2 ]]
}

# ============================================================================
# --check validation tests
# ============================================================================

@test "check: --check with valid document succeeds" {
    run run_script --markdown "$TEST_REPO_MD" --check
    [[ $status -eq 0 ]]
    [[ "$output" == *"Validation PASSED"* ]]
}

@test "check: --check does not require selection method" {
    # --check should work without --all, -i, or IDs
    run run_script --markdown "$TEST_REPO_MD" --check
    [[ $status -eq 0 ]]
}

@test "check: --check reports missing sections" {
    local bad_doc="$TEST_TEMP_DIR/repo/bad-doc.md"
    cat > "$bad_doc" << 'HEREDOC'
# Incomplete

## 1. Vision

Some content.
HEREDOC

    run run_script --markdown "$bad_doc" --check
    [[ $status -eq 1 ]]
    [[ "$output" == *"Missing Requirements section"* ]]
}

@test "check: --check reports requirements and phases count" {
    run run_script --markdown "$TEST_REPO_MD" --check
    [[ "$output" == *"Found 5 requirement(s)"* ]]
    [[ "$output" == *"Found 3 phase(s)"* ]]
}

# ============================================================================
# Annotation tests
# ============================================================================

@test "annotate: creating issue adds annotation to markdown" {
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    # The markdown file should now have GitHub Issue annotations
    grep -q '\*\*GitHub Issue:\*\*.*#1' "$TEST_REPO_MD"
}

@test "annotate: phase and requirement headings are annotated" {
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    # PHASE-01 gets issue #1, AUTH-001 gets #2, AUTH-002 gets #3
    grep -q '\*\*GitHub Issue:\*\*.*#1' "$TEST_REPO_MD"
    grep -q '\*\*GitHub Issue:\*\*.*#2' "$TEST_REPO_MD"
    grep -q '\*\*GitHub Issue:\*\*.*#3' "$TEST_REPO_MD"
}

@test "annotate: dry-run does not annotate markdown" {
    run run_script --markdown "$TEST_REPO_MD" --dry-run PHASE-01
    [[ $status -eq 0 ]]
    ! grep -q '\*\*GitHub Issue:\*\*' "$TEST_REPO_MD"
}

@test "annotate: parser still works after annotation" {
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    # Re-parse and verify counts (should still find all 5 reqs and 3 phases)
    source "$DEVENV_TOOLS/lib/requirements-parser.bash" 2>/dev/null || true
    local req_count
    req_count=$(parse_requirements "$TEST_REPO_MD" | wc -l)
    [[ $req_count -eq 5 ]]
    local phase_count
    phase_count=$(parse_phases "$TEST_REPO_MD" | wc -l)
    [[ $phase_count -eq 3 ]]
}

# ============================================================================
# Skip existing issues tests
# ============================================================================

@test "skip: already-issued items are skipped on re-run" {
    # First run: creates issues for PHASE-01 (+ AUTH-001, AUTH-002)
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    local first_count
    first_count=$(wc -l < "$MOCK_LOG")
    [[ $first_count -eq 3 ]]

    # Reset mock counter
    echo "0" > "$MOCK_ISSUE_COUNTER_FILE"
    > "$MOCK_LOG"

    # Second run: same items should be skipped
    run run_script --markdown "$TEST_REPO_MD" PHASE-01
    [[ $status -eq 0 ]]
    [[ "$output" == *"already has issue"* ]]
    # No new issue-create calls should have been made
    if [ -f "$MOCK_LOG" ]; then
        local second_count
        second_count=$(wc -l < "$MOCK_LOG")
        [[ $second_count -eq 0 ]]
    fi
}

@test "skip: skipped items still provide parent references" {
    # Create PHASE-01 first
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    echo "0" > "$MOCK_ISSUE_COUNTER_FILE"
    > "$MOCK_LOG"

    # Now create AUTH-003 which needs PHASE-02 (and PHASE-02 needs PHASE-01)
    # PHASE-01 already has an issue, so it should be skipped
    # But its issue number should still be available for PHASE-02's parent
    run_script --markdown "$TEST_REPO_MD" AUTH-003
    [[ -f "$MOCK_LOG" ]]
    # PHASE-02 and AUTH-003 should be created (2 calls)
    local call_count
    call_count=$(wc -l < "$MOCK_LOG")
    [[ $call_count -eq 2 ]]
}

# ============================================================================
# Link expansion tests
# ============================================================================

@test "expand: issue body has expanded internal links" {
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    # Check the body file for the first issue (PHASE-01 Epic)
    [[ -f "$MOCK_BODY_DIR/body-1.md" ]]
    local body_content
    body_content=$(cat "$MOCK_BODY_DIR/body-1.md")
    # The body should have full URLs, not relative anchors
    # Source link should be a full URL (already was)
    [[ "$body_content" == *"https://github.com/test-org/dummy/blob/"* ]]
    # No relative anchor links should remain
    ! echo "$body_content" | grep -q '](#'
}

# ============================================================================
# Config-based type mapping tests
# ============================================================================

@test "config: phase type comes from issues-config.yml" {
    # Default config maps phases → Epic
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    local first_call
    first_call=$(head -1 "$MOCK_LOG")
    [[ "$first_call" == *"--type"*"Epic"* ]]
}

@test "config: requirement type comes from issues-config.yml" {
    # Default config maps features → Feature
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    local second_call
    second_call=$(sed -n '2p' "$MOCK_LOG")
    [[ "$second_call" == *"--type"*"Feature"* ]]
}

@test "config: custom config overrides phase type" {
    # Create a custom config with different type mapping
    local custom_config="$TEST_TEMP_DIR/custom-issues-config.yml"
    cat > "$custom_config" << 'YML'
types:
  - name: Task
    description: "A task"
    id: "IT_test"
  - name: Bug
    description: "A bug"
    id: "IT_test2"
planning:
  type_mapping:
    phases: Task
    features: Bug
    tasks: Task
YML
    export ISSUES_CONFIG="$custom_config"
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    local first_call
    first_call=$(head -1 "$MOCK_LOG")
    [[ "$first_call" == *"--type"*"Task"* ]]
}

@test "config: custom config overrides requirement type" {
    local custom_config="$TEST_TEMP_DIR/custom-issues-config.yml"
    cat > "$custom_config" << 'YML'
types:
  - name: Task
    description: "A task"
    id: "IT_test"
  - name: Bug
    description: "A bug"
    id: "IT_test2"
planning:
  type_mapping:
    phases: Task
    features: Bug
    tasks: Task
YML
    export ISSUES_CONFIG="$custom_config"
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    local second_call
    second_call=$(sed -n '2p' "$MOCK_LOG")
    [[ "$second_call" == *"--type"*"Bug"* ]]
}

@test "config: dry-run shows configured type names" {
    local custom_config="$TEST_TEMP_DIR/custom-issues-config.yml"
    cat > "$custom_config" << 'YML'
types:
  - name: Task
    description: "A task"
    id: "IT_test"
planning:
  type_mapping:
    phases: Task
    features: Task
    tasks: Task
YML
    export ISSUES_CONFIG="$custom_config"
    run run_script --markdown "$TEST_REPO_MD" --dry-run PHASE-01
    [[ $status -eq 0 ]]
    [[ "$output" == *"PHASE-01 => Task"* ]]
    [[ "$output" == *"AUTH-001 => Task"* ]]
}

# ============================================================================
# Blocked-by prerequisite linking tests
# ============================================================================

@test "blocked-by: phase with prerequisite gets --blocked-by flag" {
    # PHASE-02 has prerequisite PHASE-01
    # When creating all, PHASE-01 -> issue #1, PHASE-02 -> issue #2
    run_script --markdown "$TEST_REPO_MD" --all
    # Find the PHASE-02 call
    local phase2_call
    phase2_call=$(grep "PHASE-02:" "$MOCK_LOG")
    [[ "$phase2_call" == *"--blocked-by"*"1"* ]]
}

@test "blocked-by: phase without prerequisites has no --blocked-by" {
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    local first_call
    first_call=$(head -1 "$MOCK_LOG")
    [[ "$first_call" != *"--blocked-by"* ]]
}

@test "blocked-by: requirement with dependencies gets --blocked-by" {
    # AUTH-002 depends on AUTH-001
    # When creating PHASE-01: PHASE-01=#1, AUTH-001=#2, AUTH-002=#3
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    local auth002_call
    auth002_call=$(grep "AUTH-002:" "$MOCK_LOG")
    [[ "$auth002_call" == *"--blocked-by"*"2"* ]]
}

@test "blocked-by: requirement without dependencies has no --blocked-by" {
    # AUTH-001 has Dependencies: None
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    local auth001_call
    auth001_call=$(grep "AUTH-001:" "$MOCK_LOG")
    [[ "$auth001_call" != *"--blocked-by"* ]]
}

@test "blocked-by: multiple prerequisites produce multiple --blocked-by flags" {
    # AUTH-003 depends on AUTH-001 and AUTH-002
    # Create all: phases first (#1,#2,#3), then reqs (AUTH-001=#4, AUTH-002=#5, AUTH-003=#6)
    run_script --markdown "$TEST_REPO_MD" --all
    local auth003_call
    auth003_call=$(grep "AUTH-003:" "$MOCK_LOG")
    # Should have --blocked-by for both AUTH-001 (issue #4) and AUTH-002 (issue #5)
    [[ "$auth003_call" == *"--blocked-by"*"4"* ]]
    [[ "$auth003_call" == *"--blocked-by"*"5"* ]]
}

@test "blocked-by: dry-run shows blocked-by info" {
    run run_script --markdown "$TEST_REPO_MD" --all --dry-run
    [[ $status -eq 0 ]]
    # PHASE-02 depends on PHASE-01, should show blocked-by in dry run output
    [[ "$output" == *"Blocked by:"* ]]
}

# ============================================================================
# Cross-session reference resolution tests
# ============================================================================

@test "cross-session: blocked-by uses issue numbers from prior run annotations" {
    # Simulate prior run: create PHASE-01 with its requirements
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    # PHASE-01=#1, AUTH-001=#2, AUTH-002=#3
    # The markdown now has annotations for these items

    # Reset the mock for a fresh session
    echo "0" > "$MOCK_ISSUE_COUNTER_FILE"
    > "$MOCK_LOG"

    # Now create AUTH-003 (depends on AUTH-001 and AUTH-002, which were created last run)
    # AUTH-003 is in PHASE-02, which will also be created
    # PHASE-02 prerequisites PHASE-01 (created last run as #1)
    run_script --markdown "$TEST_REPO_MD" AUTH-003

    # PHASE-02 should get --blocked-by 1 (PHASE-01's issue from prior run)
    local phase2_call
    phase2_call=$(grep "PHASE-02:" "$MOCK_LOG")
    [[ "$phase2_call" == *"--blocked-by"*"1"* ]]

    # AUTH-003 should get --blocked-by for AUTH-001 (#2) and AUTH-002 (#3) from prior run
    local auth003_call
    auth003_call=$(grep "AUTH-003:" "$MOCK_LOG")
    [[ "$auth003_call" == *"--blocked-by"*"2"* ]]
    [[ "$auth003_call" == *"--blocked-by"*"3"* ]]
}

@test "cross-session: parent uses issue number from prior run annotation" {
    # Create PHASE-01 in a prior run
    run_script --markdown "$TEST_REPO_MD" PHASE-01
    # PHASE-01=#1, AUTH-001=#2, AUTH-002=#3

    echo "0" > "$MOCK_ISSUE_COUNTER_FILE"
    > "$MOCK_LOG"

    # Create SRCH-001 (in PHASE-03, depends on AUTH-002 from prior run)
    # PHASE-03 prerequisites PHASE-01 (from prior run)
    run_script --markdown "$TEST_REPO_MD" SRCH-001

    # PHASE-03 should have --parent 1 (PHASE-01 from prior run)
    local phase3_call
    phase3_call=$(grep "PHASE-03:" "$MOCK_LOG")
    [[ "$phase3_call" == *"--parent"*"1"* ]]

    # SRCH-001 should have --blocked-by 3 (AUTH-002 from prior run)
    local srch001_call
    srch001_call=$(grep "SRCH-001:" "$MOCK_LOG")
    [[ "$srch001_call" == *"--blocked-by"*"3"* ]]
}

@test "cross-session: dry-run resolves references from prior annotations" {
    # Create PHASE-01 in a prior run
    run_script --markdown "$TEST_REPO_MD" PHASE-01

    # Dry-run creating PHASE-02 (prerequisites PHASE-01)
    run run_script --markdown "$TEST_REPO_MD" --dry-run AUTH-003
    [[ $status -eq 0 ]]
    # Should show blocked-by info from prior run's annotations
    [[ "$output" == *"Blocked by:"* ]]
}
