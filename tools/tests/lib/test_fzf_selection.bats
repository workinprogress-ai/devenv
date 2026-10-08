#!/usr/bin/env bats
# Tests for fzf-selection.bash library
# Tests for interactive menu selection helpers using fzf

bats_require_minimum_version 1.5.0

load ../test_helper

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
    command -v fzf >/dev/null 2>&1 || skip "fzf not installed"
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
    # fzf stand-in that records its argv; the function is really called, once
    # without a prompt (default) and once with one.
    mkdir -p "$TEST_TEMP_DIR/bin"
    export FZF_ARGS_LOG="$TEST_TEMP_DIR/fzf-args.log"
    printf '%s\n' '#!/usr/bin/env bash' \
        'printf "%s\n" "$@" > "$FZF_ARGS_LOG"' \
        'head -n 1' > "$TEST_TEMP_DIR/bin/fzf"
    chmod +x "$TEST_TEMP_DIR/bin/fzf"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    run bash -c "source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'; fzf_select_single 'item1'"
    [ "$status" -eq 0 ]
    [ "$output" = "item1" ]
    grep -qxF -- "--prompt=Select: " "$FZF_ARGS_LOG"
    run bash -c "source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'; fzf_select_single 'item1' 'Pick one: '"
    [ "$status" -eq 0 ]
    grep -qxF -- "--prompt=Pick one: " "$FZF_ARGS_LOG"
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
# Item text is data: no escape processing, blank-safe counting
# ============================================================================

# fzf stand-in: records what it is fed and "selects" the first line.
install_recording_fzf() {
    mkdir -p "$TEST_TEMP_DIR/bin"
    export FZF_STDIN_LOG="$TEST_TEMP_DIR/fzf-stdin.log"
    : > "$FZF_STDIN_LOG"
    printf '%s\n' '#!/usr/bin/env bash' \
        'cat > "$FZF_STDIN_LOG"' \
        'head -n 1 "$FZF_STDIN_LOG"' > "$TEST_TEMP_DIR/bin/fzf"
    chmod +x "$TEST_TEMP_DIR/bin/fzf"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
}

@test "fzf-selection: fzf_select_single feeds item text to fzf without escape processing" {
    install_recording_fzf
    local items=$'C:\\new\\table\nsecond \\\\ item\nwith a \\t literal'
    run bash -c "source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'; fzf_select_single \"\$1\" 'Pick:'" _ "$items"
    [ "$status" -eq 0 ]
    [ "$(cat "$FZF_STDIN_LOG")" = "$items" ]
    [ "$output" = 'C:\new\table' ]
}

@test "fzf-selection: fzf_select_single returns an item that looks like an echo option" {
    install_recording_fzf
    run bash -c "source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'; fzf_select_single \$'-n\nother' 'Pick:'"
    [ "$status" -eq 0 ]
    [ "$output" = "-n" ]
}

@test "fzf-selection: fzf_select_multi feeds item text to fzf without escape processing" {
    install_recording_fzf
    local items=$'a\\nb\nc\\\\d'
    run bash -c "source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'; fzf_select_multi \"\$1\" 'Pick:'" _ "$items"
    [ "$status" -eq 0 ]
    [ "$(cat "$FZF_STDIN_LOG")" = "$items" ]
}

@test "fzf-selection: fzf_select_smart auto-selects the one real item, not the whole blob" {
    # A blank line around the only item (and a backslash in it) used to make
    # the "single item" path print the entire raw list.
    run bash -c "source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'; fzf_select_smart \$'\n'\"only\\\\item\"\$'\n' 'Pick:'"
    [ "$status" -eq 0 ]
    [ "$output" = 'only\item' ]
}

@test "fzf-selection: fzf_select_smart counts only non-blank lines and shows the menu without blanks" {
    install_recording_fzf
    run bash -c "source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'; fzf_select_smart \$'a\n\nb\n' 'Pick:'"
    [ "$status" -eq 0 ]
    [ "$(cat "$FZF_STDIN_LOG")" = $'a\nb' ]
}

@test "fzf-selection: fzf_select_smart reports an all-blank list instead of dying under set -e" {
    run bash -c "set -e; source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'; fzf_select_smart \$'\n\n' 'Pick:'"
    [ "$status" -eq 1 ]
    [[ "$output" == *"No items to select from"* ]]
}

@test "fzf-selection: fzf_select_filtered passes matching items through verbatim" {
    install_recording_fzf
    run bash -c "source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'; fzf_select_filtered \$'keep \\\\n one\nskip\nkeep two' 'keep' 'Pick:'"
    [ "$status" -eq 0 ]
    [ "$(cat "$FZF_STDIN_LOG")" = $'keep \\n one\nkeep two' ]
}

# fzf stand-in: records its arguments and answers like `--expect` does (key line, then item).
install_expect_fzf() {
    mkdir -p "$TEST_TEMP_DIR/bin"
    export FZF_ARGS_LOG="$TEST_TEMP_DIR/fzf-args.log"
    printf '%s\n' '#!/usr/bin/env bash' \
        'printf "%s\n" "$@" > "$FZF_ARGS_LOG"' \
        'cat > /dev/null' \
        'printf "ctrl-x\nfirst\n"' > "$TEST_TEMP_DIR/bin/fzf"
    chmod +x "$TEST_TEMP_DIR/bin/fzf"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
}

@test "fzf-selection: fzf_select_multi passes --expect and returns the key line first when keys are given" {
    install_expect_fzf
    run bash -c "source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'; fzf_select_multi \$'first\nsecond' 'Pick:' '' 'ctrl-x'"
    [ "$status" -eq 0 ]
    [ "$output" = $'ctrl-x\nfirst' ]
    grep -qx -- '--expect=ctrl-x' "$FZF_ARGS_LOG"
}

@test "fzf-selection: fzf_select_multi passes no --expect without keys" {
    install_expect_fzf
    run bash -c "source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'; fzf_select_multi \$'first\nsecond' 'Pick:'"
    [ "$status" -eq 0 ]
    run grep -c -- '--expect' "$FZF_ARGS_LOG"
    [ "$output" = "0" ]
}

# ============================================================================
# fzf_select_multi_or_action Tests
# ============================================================================

@test "fzf-selection: fzf_select_multi_or_action returns 0 and items on a plain Enter selection" {
    mkdir -p "$TEST_TEMP_DIR/bin"
    printf '%s\n' '#!/usr/bin/env bash' 'cat > /dev/null' 'printf "\nfirst\n"' > "$TEST_TEMP_DIR/bin/fzf"
    chmod +x "$TEST_TEMP_DIR/bin/fzf"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    run bash -c "source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'; fzf_select_multi_or_action \$'first\nsecond' 'Pick:' '' 'ctrl-x'"
    [ "$status" -eq 0 ]
    [ "$output" = "first" ]
}

@test "fzf-selection: fzf_select_multi_or_action returns 2 and items when the action key is pressed" {
    install_expect_fzf
    run bash -c "source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'; fzf_select_multi_or_action \$'first\nsecond' 'Pick:' '' 'ctrl-x'"
    [ "$status" -eq 2 ]
    [ "$output" = "first" ]
}

@test "fzf-selection: fzf_select_multi_or_action returns 1 on cancel (ctrl-c/esc), distinct from the action key" {
    mkdir -p "$TEST_TEMP_DIR/bin"
    printf '%s\n' '#!/usr/bin/env bash' 'cat > /dev/null' 'exit 1' > "$TEST_TEMP_DIR/bin/fzf"
    chmod +x "$TEST_TEMP_DIR/bin/fzf"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    run bash -c "source '$PROJECT_ROOT/tools/lib/fzf-selection.bash'; fzf_select_multi_or_action \$'first\nsecond' 'Pick:' '' 'ctrl-x'"
    [ "$status" -eq 1 ]
}
