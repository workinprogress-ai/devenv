#!/usr/bin/env bats
# Test suite for markdown.bash library

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    source "$DEVENV_ROOT/tools/lib/error-handling.bash"
    source "$DEVENV_ROOT/tools/lib/markdown.bash"

    # Create a minimal implementation plan fixture
    PLAN_FILE="$TEST_TEMP_DIR/Implementation_plan-test-001.md"
    cat > "$PLAN_FILE" << 'EOF'
# Test Plan

## Task List

### Phase 1

- [ ] **1.1 [S] First task**
  - Do something

- [x] **1.2 [M] Already done task**
  - Already finished

- [ ] **1.3 [S] Third task**

### Phase 2

- [ ] **2.1 [M] Phase two task**

- [ ] **2.1.1 [S] Sub-task of 2.1**

- [ ] **2.3 [L] Large task**
EOF
}

teardown() {
    test_helper_teardown
}

# ============================================================================
# validate_plan_task_number
# ============================================================================

@test "validate_plan_task_number accepts X.Y format" {
    run validate_plan_task_number "2.3"
    [ "$status" -eq 0 ]
}

@test "validate_plan_task_number accepts X.Y.Z format" {
    run validate_plan_task_number "1.4.2"
    [ "$status" -eq 0 ]
}

@test "validate_plan_task_number rejects plain integer" {
    run validate_plan_task_number "3"
    [ "$status" -ne 0 ]
}

@test "validate_plan_task_number rejects empty string" {
    run validate_plan_task_number ""
    [ "$status" -ne 0 ]
}

@test "validate_plan_task_number rejects non-numeric segment" {
    run validate_plan_task_number "1.a.2"
    [ "$status" -ne 0 ]
}

@test "validate_plan_task_number rejects four-segment number" {
    run validate_plan_task_number "1.2.3.4"
    [ "$status" -ne 0 ]
}

# ============================================================================
# find_plan_task_line
# ============================================================================

@test "find_plan_task_line returns line number for existing task" {
    run find_plan_task_line "$PLAN_FILE" "1.1"
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^[0-9]+$ ]]
}

@test "find_plan_task_line locates correct line for task 1.2" {
    local line
    line=$(find_plan_task_line "$PLAN_FILE" "1.2")
    # The line should contain the task text
    local content
    content=$(sed -n "${line}p" "$PLAN_FILE")
    [[ "$content" =~ "1.2" ]]
}

@test "find_plan_task_line returns error for missing task" {
    run find_plan_task_line "$PLAN_FILE" "9.9"
    [ "$status" -ne 0 ]
}

@test "find_plan_task_line returns error for missing file" {
    run find_plan_task_line "/nonexistent/plan.md" "1.1"
    [ "$status" -ne 0 ]
}

@test "find_plan_task_line handles sub-task X.Y.Z" {
    run find_plan_task_line "$PLAN_FILE" "2.1.1"
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^[0-9]+$ ]]
}

# ============================================================================
# is_plan_task_complete
# ============================================================================

@test "is_plan_task_complete returns 0 for a completed task" {
    run is_plan_task_complete "$PLAN_FILE" "1.2"
    [ "$status" -eq 0 ]
}

@test "is_plan_task_complete returns 1 for an incomplete task" {
    run is_plan_task_complete "$PLAN_FILE" "1.1"
    [ "$status" -eq 1 ]
}

@test "is_plan_task_complete returns non-zero on missing task" {
    run is_plan_task_complete "$PLAN_FILE" "9.9"
    [ "$status" -ne 0 ]
}

# ============================================================================
# set_plan_task_complete — marking complete
# ============================================================================

@test "set_plan_task_complete marks incomplete task as complete" {
    set_plan_task_complete "$PLAN_FILE" "1.1" "complete"
    run is_plan_task_complete "$PLAN_FILE" "1.1"
    [ "$status" -eq 0 ]
}

@test "set_plan_task_complete is idempotent when already complete" {
    set_plan_task_complete "$PLAN_FILE" "1.2" "complete"
    run is_plan_task_complete "$PLAN_FILE" "1.2"
    [ "$status" -eq 0 ]
}

@test "set_plan_task_complete does not corrupt other tasks" {
    set_plan_task_complete "$PLAN_FILE" "1.1" "complete"
    # Task 1.3 should still be incomplete
    run is_plan_task_complete "$PLAN_FILE" "1.3"
    [ "$status" -eq 1 ]
    # Task 1.2 should still be complete
    run is_plan_task_complete "$PLAN_FILE" "1.2"
    [ "$status" -eq 0 ]
}

@test "set_plan_task_complete works for Phase 2 task" {
    set_plan_task_complete "$PLAN_FILE" "2.3" "complete"
    run is_plan_task_complete "$PLAN_FILE" "2.3"
    [ "$status" -eq 0 ]
}

@test "set_plan_task_complete works for sub-task X.Y.Z" {
    set_plan_task_complete "$PLAN_FILE" "2.1.1" "complete"
    run is_plan_task_complete "$PLAN_FILE" "2.1.1"
    [ "$status" -eq 0 ]
}

# ============================================================================
# set_plan_task_complete — marking incomplete
# ============================================================================

@test "set_plan_task_complete marks complete task as incomplete" {
    set_plan_task_complete "$PLAN_FILE" "1.2" "incomplete"
    run is_plan_task_complete "$PLAN_FILE" "1.2"
    [ "$status" -eq 1 ]
}

@test "set_plan_task_complete is idempotent when already incomplete" {
    set_plan_task_complete "$PLAN_FILE" "1.1" "incomplete"
    run is_plan_task_complete "$PLAN_FILE" "1.1"
    [ "$status" -eq 1 ]
}

# ============================================================================
# count_plan_tasks
# ============================================================================

@test "count_plan_tasks returns correct total" {
    local counts completed total
    counts=$(count_plan_tasks "$PLAN_FILE")
    completed="${counts%% *}"
    total="${counts##* }"
    [ "$total" -eq 6 ]
}

@test "count_plan_tasks returns correct completed count" {
    local counts completed total
    counts=$(count_plan_tasks "$PLAN_FILE")
    completed="${counts%% *}"
    # Fixture has 1 pre-completed task (1.2)
    [ "$completed" -eq 1 ]
}

@test "count_plan_tasks updates after completing a task" {
    set_plan_task_complete "$PLAN_FILE" "1.1" "complete"
    local counts completed
    counts=$(count_plan_tasks "$PLAN_FILE")
    completed="${counts%% *}"
    [ "$completed" -eq 2 ]
}

@test "count_plan_tasks returns error for missing file" {
    run count_plan_tasks "/nonexistent/plan.md"
    [ "$status" -ne 0 ]
}
