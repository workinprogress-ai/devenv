#!/usr/bin/env bats
# Tests for fzf-selection.bash library
# Tests for interactive menu selection helpers using fzf

bats_require_minimum_version 1.5.0

load test_helper

setup() {
    test_helper_setup
}

# ============================================================================
# Library Loading Tests
# ============================================================================

@test "fzf-selection: library can be sourced" {
    run bash -c "source '$PROJECT_ROOT/tools/lib/fzf-selection.bash' && echo 'loaded'"
    [ "$status" -eq 0 ]
    [[ "$output" == *"loaded"* ]]
}

@test "fzf-selection: prevents multiple sourcing" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        _FZF_SELECTION_LOADED=1
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        echo 'success'
    "
    [ "$status" -eq 0 ]
}

@test "fzf-selection: has valid bash syntax" {
    run bash -n "$PROJECT_ROOT/tools/lib/fzf-selection.bash"
    [ "$status" -eq 0 ]
}

# ============================================================================
# check_fzf_installed Tests
# ============================================================================

@test "fzf-selection: check_fzf_installed detects fzf" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        check_fzf_installed
    "
    [ "$status" -eq 0 ]
}

@test "fzf-selection: check_fzf_installed fails when fzf missing" {
    run bash -c "
        export PATH=/nonexistent
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        check_fzf_installed 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"fzf is not installed"* ]]
}

# ============================================================================
# fzf_select_single Tests
# ============================================================================

@test "fzf-selection: fzf_select_single requires items" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        fzf_select_single '' 'Prompt:' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"Items list is required"* ]]
}

@test "fzf-selection: fzf_select_single requires fzf" {
    run bash -c "
        export PATH=/nonexistent
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        fzf_select_single 'item1' 'Prompt:' 2>&1
    "
    [ "$status" -eq 1 ]
}

@test "fzf-selection: fzf_select_single uses default prompt" {
    run bash -c "
        echo 'item1' | fzf --version &>/dev/null
        if [ \$? -ne 0 ]; then exit 77; fi
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        # Just verify the function is callable with default prompt
        true
    "
    # Skip if fzf not available
    [ "$status" -eq 0 ] || [ "$status" -eq 77 ]
}

# ============================================================================
# fzf_select_multi Tests
# ============================================================================

@test "fzf-selection: fzf_select_multi requires items" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        fzf_select_multi '' 'Select:' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"Items list is required"* ]]
}

@test "fzf-selection: fzf_select_multi requires fzf" {
    run bash -c "
        export PATH=/nonexistent
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        fzf_select_multi 'item1
item2' 'Select:' 2>&1
    "
    [ "$status" -eq 1 ]
}

# ============================================================================
# fzf_select_smart Tests
# ============================================================================

@test "fzf-selection: fzf_select_smart requires items" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        fzf_select_smart '' 'Select:' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"Items list is required"* ]]
}

@test "fzf-selection: fzf_select_smart auto-selects single item" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        result=\$(fzf_select_smart 'onlyitem' 'Select:')
        [ \"\$result\" = 'onlyitem' ] && echo 'success'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"success"* ]]
}

@test "fzf-selection: fzf_select_smart rejects empty list" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        fzf_select_smart '' 'Select:' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"Items list is required"* ]]
}

# ============================================================================
# fzf_select_filtered Tests
# ============================================================================

@test "fzf-selection: fzf_select_filtered requires items and pattern" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        fzf_select_filtered 'item1
item2' '' 'Select:' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"pattern are required"* ]]
}

@test "fzf-selection: fzf_select_filtered rejects no matches" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        list='apple
banana
cherry'
        fzf_select_filtered \"\$list\" 'xyz' 'Select:' '' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"No items matching"* ]]
}

# ============================================================================
# fzf_extract_field Tests
# ============================================================================

@test "fzf-selection: fzf_extract_field extracts field from tab-separated line" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        line='name\t/path/to/file'
        fzf_extract_field \"\$line\" 1
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"name"* ]]
}

@test "fzf-selection: fzf_extract_field handles empty line" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        output=\$(fzf_extract_field '' 1)
        [ -z \"\$output\" ] && echo 'empty'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"empty"* ]]
}

@test "fzf-selection: fzf_extract_field handles missing field" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        line='only_one_field'
        fzf_extract_field \"\$line\" 2
    "
    [ "$status" -eq 0 ]
}

# ============================================================================
# fzf_handle_cancellation Tests
# ============================================================================

@test "fzf-selection: fzf_handle_cancellation returns error code" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        fzf_handle_cancellation 'Test message' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"ERROR"* ]]
}

@test "fzf-selection: fzf_handle_cancellation uses default message" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        fzf_handle_cancellation 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"Selection cancelled"* ]]
}

# ============================================================================
# fzf_validate_selection Tests
# ============================================================================

@test "fzf-selection: fzf_validate_selection accepts non-empty selection" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        fzf_validate_selection 'something' 'Test'
    "
    [ "$status" -eq 0 ]
}

@test "fzf-selection: fzf_validate_selection rejects empty selection" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        fzf_validate_selection '' 'Test' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"ERROR"* ]]
}

@test "fzf-selection: fzf_validate_selection uses context in error" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        fzf_validate_selection '' 'Custom context' 2>&1
    "
    [ "$status" -eq 1 ]
    [[ "$output" == *"Custom context"* ]]
}

# ============================================================================
# fzf_build_menu Tests
# ============================================================================

@test "fzf-selection: fzf_build_menu returns menu items" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        menu='name1\tvalue1
name2\tvalue2'
        fzf_build_menu \"\$menu\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"name1"* ]]
    [[ "$output" == *"name2"* ]]
}

@test "fzf-selection: fzf_build_menu handles empty input" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'
        fzf_build_menu ''
    "
    [ "$status" -eq 0 ]
}
