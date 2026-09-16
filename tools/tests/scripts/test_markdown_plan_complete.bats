#!/usr/bin/env bats
# Tests for markdown-plan-complete-task / markdown-plan-complete-ac
# auto-detect order (shared: .local-artifacts/ first, then cwd)

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup

    # A plan in the cwd and a DIFFERENT stale plan in .local-artifacts/ —
    # auto-detect must resolve the .local-artifacts/ copy first in both tools.
    WORK_DIR="$TEST_TEMP_DIR/work"
    ART_DIR="$TEST_TEMP_DIR/work/.local-artifacts"
    mkdir -p "$WORK_DIR" "$ART_DIR"

    cat > "$ART_DIR/Plan-issue-9-001.md" << 'EOF'
# Artifact plan

## Phase 1 — A

- [ ] **1.1 [S] artifact copy task**
EOF

    cat > "$WORK_DIR/Plan-issue-9-001.md" << 'EOF'
# Cwd plan

## Phase 1 — A

- [ ] **1.1 [S] cwd copy task**
EOF
}

@test "task tool auto-detect prefers .local-artifacts/ over cwd" {
    cd "$WORK_DIR"
    run bash "$DEVENV_TOOLS/scripts/markdown-plan-complete-task.sh" 1.1
    [ "$status" -eq 0 ]
    [[ "$output" == *".local-artifacts/Plan-issue-9-001.md"* ]]
    # cwd copy untouched
    grep -q "\[ \] \*\*1.1" "$WORK_DIR/Plan-issue-9-001.md"
    # artifact copy ticked
    grep -q "\[x\] \*\*1.1" "$ART_DIR/Plan-issue-9-001.md"
}

@test "ac tool auto-detect prefers .local-artifacts/ over cwd" {
    cd "$WORK_DIR"
    # AC checkboxes for the ac tool
    cat >> "$ART_DIR/Plan-issue-9-001.md" << 'EOF'

- [ ] **AC-1** artifact copy criterion
EOF
    cat >> "$WORK_DIR/Plan-issue-9-001.md" << 'EOF'

- [ ] **AC-1** cwd copy criterion
EOF
    run bash "$DEVENV_TOOLS/scripts/markdown-plan-complete-ac.sh" AC-1
    [ "$status" -eq 0 ]
    grep -q "\[x\] \*\*AC-1\*\* artifact copy criterion" "$ART_DIR/Plan-issue-9-001.md"
    grep -q "\[ \] \*\*AC-1\*\* cwd copy criterion" "$WORK_DIR/Plan-issue-9-001.md"
}

@test "task tool falls back to cwd when .local-artifacts/ has no plan" {
    rm "$ART_DIR/Plan-issue-9-001.md"
    cd "$WORK_DIR"
    run bash "$DEVENV_TOOLS/scripts/markdown-plan-complete-task.sh" 1.1
    [ "$status" -eq 0 ]
    grep -q "\[x\] \*\*1.1" "$WORK_DIR/Plan-issue-9-001.md"
}

@test "explicit file argument beats auto-detect in task tool" {
    cd "$WORK_DIR"
    run bash "$DEVENV_TOOLS/scripts/markdown-plan-complete-task.sh" 1.1 "$WORK_DIR/Plan-issue-9-001.md"
    [ "$status" -eq 0 ]
    grep -q "\[x\] \*\*1.1" "$WORK_DIR/Plan-issue-9-001.md"
    grep -q "\[ \] \*\*1.1" "$ART_DIR/Plan-issue-9-001.md"
}
