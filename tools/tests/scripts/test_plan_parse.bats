#!/usr/bin/env bats
# Tests for plan-parse script (structure, census, anchors, summary modes)

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup

    PLAN_DIR="$TEST_TEMP_DIR"
    PLAN_FILE="$PLAN_DIR/Plan-issue-42-001.md"
    cat > "$PLAN_FILE" << 'EOF'
# Test plan

## Goals and Acceptance Criteria

- [x] <a id="ac-1"></a>**AC-1** first criterion
- [ ] **AC-2** second criterion

## Phases

### Phase 1 — First phase

- [x] **1.1 [S] sized done task**
- [x] **1.2 [L] sized done task two**
- [ ] 1.3 unsized open task
  - detail line
  - [QUESTION] should this be async?

### Phase 2 — Second phase

- [ ] **2.1 [M] medium open task**
- [x] **2.2 [S] small done task**

### Phase 3 — Third phase (no tasks yet)

### Phase 4 — Fourth phase

- [ ] **4.1 [L] large open task**
EOF

    LEGACY_FILE="$PLAN_DIR/Implementation_plan-issue-7-001.md"
    cp "$PLAN_FILE" "$LEGACY_FILE"
}

# ---------------------------------------------------------------------------
# Summary mode (--summary)
# ---------------------------------------------------------------------------

@test "plan-parse --summary emits valid JSON" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    echo "$output" | jq -e . > /dev/null
}

@test "plan-parse --summary counts tasks (done/open/total)" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.tasks_done')" = "3" ]
    [ "$(echo "$output" | jq -r '.tasks_open')" = "3" ]
    [ "$(echo "$output" | jq -r '.tasks_total')" = "6" ]
}

@test "plan-parse --summary computes raw percentage" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.pct_tasks')" = "50" ]
}

@test "plan-parse --summary applies size weights S=1 M=2 L=4" {
    # done: 1.1[S]=1 + 1.2[L]=4 + 2.2[S]=1 = 6
    # total: 1[S] + 4[L] + 2[unsized->M] + 2[M] + 1[S] + 4[L] = 14
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.weighted.done')" = "6" ]
    [ "$(echo "$output" | jq -r '.weighted.total')" = "14" ]
    [ "$(echo "$output" | jq -r '.weighted.pct')" = "42.9" ]
}

@test "plan-parse --summary defaults missing size to M" {
    # 1.3 carries no [S|M|L] token and must count with weight 2 (included in
    # the weighted.total check above: 1+4+2+2+1+4 = 14)
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.weighted.total')" = "14" ]
}

@test "plan-parse --summary reports sized_tasks ratio" {
    # 5 of 6 tasks carry a size token
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.sized_tasks')" = "0.83" ]
}

@test "plan-parse --summary counts phases with tasks only" {
    # Phase 3 has no tasks and must not count toward phases_total
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.phases_total')" = "3" ]
}

@test "plan-parse --summary computes phases_complete" {
    # No phase is fully done (phase 1 has an open task)
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.phases_complete')" = "0" ]
}

@test "plan-parse --summary marks first phase with open tasks as current" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.current_phase')" = "1" ]
}

@test "plan-parse --summary counts open questions" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.open_questions')" = "1" ]
}

@test "plan-parse --summary counts unchecked ACs" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.unchecked_acs')" = "1" ]
}

@test "plan-parse --summary reports plan_file basename" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.plan_file')" = "Plan-issue-42-001.md" ]
}

@test "plan-parse --summary accepts legacy Implementation_plan stem" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$LEGACY_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.plan_file')" = "Implementation_plan-issue-7-001.md" ]
    [ "$(echo "$output" | jq -r '.tasks_total')" = "6" ]
}

@test "plan-parse --summary detects fully-complete phases" {
    sed -i 's/- \[ \] 1.3 unsized open task/- [x] 1.3 unsized open task/' "$PLAN_FILE"
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.phases_complete')" = "1" ]
    [ "$(echo "$output" | jq -r '.current_phase')" = "2" ]
}

@test "plan-parse --summary all-done plan reports last phase as current" {
    sed -i 's/^- \[ \]/- [x]/' "$PLAN_FILE"
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.current_phase')" = "4" ]
    [ "$(echo "$output" | jq -r '.tasks_open')" = "0" ]
}

@test "plan-parse --summary on empty plan yields zeros" {
    echo "# Empty plan" > "$PLAN_DIR/Plan-empty.md"
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_DIR/Plan-empty.md" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.tasks_total')" = "0" ]
    [ "$(echo "$output" | jq -r '.pct_tasks')" = "0" ]
}

# ---------------------------------------------------------------------------
# Regression: existing modes still work after the summary extension
# ---------------------------------------------------------------------------

@test "plan-parse --census still reports per-phase counts" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --census
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.totals.tasks')" = "6" ]
    [ "$(echo "$output" | jq -r '[.census[].done] | add')" = "3" ]
}

@test "plan-parse --structure still reports phases and tasks" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --structure
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.phases | length')" = "4" ]
    [ "$(echo "$output" | jq -r '[.phases[].tasks | length] | add')" = "6" ]
}

@test "plan-parse --structure task text preserved" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --structure
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.phases[0].tasks[0].text')" = "sized done task" ]
}

@test "plan-parse --anchors still lists file paths" {
    echo "- Files: \`src/Worker.cs\`" >> "$PLAN_FILE"
    touch "$PLAN_DIR/src/Worker.cs" 2>/dev/null || mkdir -p "$PLAN_DIR/src" && touch "$PLAN_DIR/src/Worker.cs"
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --anchors
    [ "$status" -eq 0 ]
    echo "$output" | jq -e '.anchors[] | select(.path == "src/Worker.cs" and .exists == true)' > /dev/null
}

# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------

@test "plan-parse --summary fails on missing file" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_DIR/nope.md" --summary
    [ "$status" -eq 2 ]
}

@test "plan-parse requires a file argument" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" --summary
    [ "$status" -eq 2 ]
}

# ---------------------------------------------------------------------------
# Header routing fields in --summary
# ---------------------------------------------------------------------------

@test "plan-parse --summary emits null header fields when header absent" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.doc_id')" = "null" ]
    [ "$(echo "$output" | jq -r '.issue_number')" = "null" ]
    [ "$(echo "$output" | jq -r '.planning_repo')" = "null" ]
}

@test "plan-parse --summary emits header routing fields when present" {
    sed -i '1i <!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:test-org/test-repo:issue-42:plan:test-slug\nartifact_type: plan\nissue_number: 42\nplanning_repo: test-org/planning.main\n-->' "$PLAN_FILE"
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --summary
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.doc_id')" = "dv1:test-org/test-repo:issue-42:plan:test-slug" ]
    [ "$(echo "$output" | jq -r '.issue_number')" = "42" ]
    [ "$(echo "$output" | jq -r '.planning_repo')" = "test-org/planning.main" ]
    # metrics unaffected by header presence
    [ "$(echo "$output" | jq -r '.tasks_total')" = "6" ]
}

# ---------------------------------------------------------------------------
# Lint mode (--lint)
# ---------------------------------------------------------------------------

@test "plan-parse --lint passes a structurally valid plan" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --lint
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.ok')" = "true" ]
    [ "$(echo "$output" | jq -r '.errors | length')" = "0" ]
}

@test "plan-parse --lint emits valid JSON" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --lint
    [ "$status" -eq 0 ]
    echo "$output" | jq -e . > /dev/null
}

@test "plan-parse --lint flags missing phases" {
    echo "# No phases here" > "$PLAN_DIR/Plan-nophase.md"
    printf -- "- [ ] **1.1 [S] orphan task**\n" >> "$PLAN_DIR/Plan-nophase.md"
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_DIR/Plan-nophase.md" --lint
    [ "$status" -eq 1 ]
    echo "$output" | jq -e '.errors[] | select(test("no Phase headings"))' > /dev/null
}

@test "plan-parse --lint flags alphabetic task suffix" {
    sed -i 's/- \[ \] 1.3 unsized open task/- [ ] 1.3a unsized open task/' "$PLAN_FILE"
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --lint
    [ "$status" -eq 1 ]
    echo "$output" | jq -e '.errors[] | select(test("alphabetic suffix"))' > /dev/null
}

@test "plan-parse --lint flags duplicate task ids" {
    sed -i 's/- \[x\] \*\*2.2 \[S\] small done task\*\*/- [x] **1.1 [S] dup of earlier task**/' "$PLAN_FILE"
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --lint
    [ "$status" -eq 1 ]
    echo "$output" | jq -e '.errors[] | select(test("duplicate task id"))' > /dev/null
}

@test "plan-parse --lint flags Revision History section" {
    printf -- "\n## Revision History\n\n| Date | Change |\n|---|---|\n| 2026-01-01 | created |\n" >> "$PLAN_FILE"
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --lint
    [ "$status" -eq 1 ]
    echo "$output" | jq -e '.errors[] | select(test("Revision History"))' > /dev/null
}

@test "plan-parse --lint warns on phase with no tasks" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --lint
    [ "$status" -eq 0 ]
    echo "$output" | jq -e '.warnings[] | select(test("phase 3 has no tasks"))' > /dev/null
}

@test "plan-parse --lint warns on missing size tokens (mixed sizing only)" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --lint
    [ "$status" -eq 0 ]
    echo "$output" | jq -e '.warnings[] | select(test("size token"))' > /dev/null
}

@test "plan-parse --lint does not warn on size tokens when all sized" {
    sed -i 's/^- \[ \] 1.3 unsized open task/- [ ] **1.3 [M] sized now**/' "$PLAN_FILE"
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --lint
    [ "$status" -eq 0 ]
    ! echo "$output" | jq -e '.warnings[] | select(test("size token"))' > /dev/null
}

# ---------------------------------------------------------------------------
# --require-header (upsert gate)
# ---------------------------------------------------------------------------

@test "plan-parse --lint --require-header flags missing header" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --lint --require-header
    [ "$status" -eq 1 ]
    echo "$output" | jq -e '.errors[] | select(test("header missing"))' > /dev/null
}

@test "plan-parse --lint --require-header passes valid header" {
    sed -i '1i <!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:test-org/test-repo:issue-42:plan:test-slug\nartifact_type: plan\nissue_number: 42\nplanning_repo: test-org/planning.main\nupdated_at_utc: 2026-09-10T00:00:00Z\n-->' "$PLAN_FILE"
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --lint --require-header
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.ok')" = "true" ]
}

@test "plan-parse --lint --require-header flags malformed doc_id" {
    sed -i '1i <!-- DEVENV_ARTIFACT_V1\ndoc_id: not-a-doc-id\nartifact_type: plan\n-->' "$PLAN_FILE"
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --lint --require-header
    [ "$status" -eq 1 ]
    echo "$output" | jq -e '.errors[] | select(test("deterministic format"))' > /dev/null
}

@test "plan-parse --lint --require-header flags wrong artifact_type" {
    sed -i '1i <!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:test-org/test-repo:issue-42:plan:test-slug\nartifact_type: roadmap\n-->' "$PLAN_FILE"
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --lint --require-header
    [ "$status" -eq 1 ]
    echo "$output" | jq -e '.errors[] | select(test("expected .plan."))' > /dev/null
}

@test "plan-parse --lint --require-header flags malformed planning_repo" {
    sed -i '1i <!-- DEVENV_ARTIFACT_V1\ndoc_id: dv1:test-org/test-repo:issue-42:plan:test-slug\nartifact_type: plan\nplanning_repo: not-a-repo-form\n-->' "$PLAN_FILE"
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --lint --require-header
    [ "$status" -eq 1 ]
    echo "$output" | jq -e '.errors[] | select(test("owner/repo form"))' > /dev/null
}

@test "plan-parse --require-header rejected without --lint" {
    run bash "$DEVENV_TOOLS/scripts/plan-parse.sh" "$PLAN_FILE" --require-header
    [ "$status" -eq 2 ]
    [[ "$output" == *"only valid together with --lint"* ]]
}
