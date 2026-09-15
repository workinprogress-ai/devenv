#!/usr/bin/env bats
# Tests for body-source.bash library
# Shared markdown body-source resolution for tools

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
}

# ============================================================================
# Library Loading Tests
# ============================================================================

@test "body-source: library can be sourced" {
    run bash -c "source '$PROJECT_ROOT/tools/lib/body-source.bash' && echo 'loaded'"
    [ "$status" -eq 0 ]
    [[ "$output" == *"loaded"* ]]
}

@test "body-source: prevents multiple sourcing" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        echo 'success'
    "
    [ "$status" -eq 0 ]
}

@test "body-source: has valid bash syntax" {
    run bash -n "$PROJECT_ROOT/tools/lib/body-source.bash"
    [ "$status" -eq 0 ]
}

@test "body-source: passes shellcheck" {
    run shellcheck "$PROJECT_ROOT/tools/lib/body-source.bash"
    [ "$status" -eq 0 ]
}

# ============================================================================
# body_source_resolve Tests — text source
# ============================================================================

@test "resolve: --body text wins and prints body" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        body_source_resolve 'hello body' '' > '$TEST_TEMP_DIR/out.txt'
        echo \"result=\$BODY_SOURCE_RESULT\"
        cat '$TEST_TEMP_DIR/out.txt'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"result=text"* ]]
    [[ "$output" == *"hello body"* ]]
}

@test "resolve: both text and file given is a conflict" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        body_source_resolve 'text' '/tmp/some-file.md'
    "
    [ "$status" -eq 2 ]
    [[ "$output" == *"Only one body source"* ]]
}

# ============================================================================
# body_source_resolve Tests — file source
# ============================================================================

@test "resolve: --body-file reads the named file" {
    printf 'file body line\n' > "$TEST_TEMP_DIR/body.md"
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        body_source_resolve '' '$TEST_TEMP_DIR/body.md' > '$TEST_TEMP_DIR/out.txt'
        echo \"result=\$BODY_SOURCE_RESULT\"
        cat '$TEST_TEMP_DIR/out.txt'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"result=file"* ]]
    [[ "$output" == *"file body line"* ]]
}

@test "resolve: --body-file missing file errors" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        body_source_resolve '' '$TEST_TEMP_DIR/does-not-exist.md'
    "
    [ "$status" -eq 2 ]
    [[ "$output" == *"File not found"* ]]
}

@test "resolve: --body-file - reads stdin (decision D4)" {
    printf 'piped via dash\n' > "$TEST_TEMP_DIR/in.txt"
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        body_source_resolve '' '-' < '$TEST_TEMP_DIR/in.txt' > '$TEST_TEMP_DIR/out.txt'
        echo \"result=\$BODY_SOURCE_RESULT\"
        cat '$TEST_TEMP_DIR/out.txt'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"piped via dash"* ]]
    [[ "$output" == *"result=stdin"* ]]
}

# ============================================================================
# body_source_resolve Tests — auto-stdin (decision D1)
# ============================================================================

@test "resolve: no flags with piped stdin auto-reads" {
    printf 'auto-read body\n' > "$TEST_TEMP_DIR/in.txt"
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        body_source_resolve '' '' < '$TEST_TEMP_DIR/in.txt' > '$TEST_TEMP_DIR/out.txt'
        echo \"result=\$BODY_SOURCE_RESULT\"
        cat '$TEST_TEMP_DIR/out.txt'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"auto-read body"* ]]
    [[ "$output" == *"result=stdin"* ]]
}

@test "resolve: empty piped stdin is a hard error" {
    : > "$TEST_TEMP_DIR/in.txt"
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        body_source_resolve '' '' < '$TEST_TEMP_DIR/in.txt'
    "
    [ "$status" -eq 2 ]
    [[ "$output" == *"Refusing empty stdin"* ]]
}

@test "resolve: whitespace-only piped stdin is a hard error" {
    # read -n 1 treats a space as data, so the lib must trim before deciding.
    printf '   \n\n' > "$TEST_TEMP_DIR/in.txt"
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        body_source_resolve '' '' < '$TEST_TEMP_DIR/in.txt'
    "
    [ "$status" -eq 2 ]
    [[ "$output" == *"Refusing empty stdin"* ]]
}

@test "resolve: closed stdin is a hard error (never hangs)" {
    run timeout 5 bash -c "
        exec 0<&-
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        body_source_resolve '' ''
    "
    [ "$status" -eq 2 ]
    [[ "$output" == *"Refusing empty stdin"* ]]
}

# ============================================================================
# body_source_resolve Tests — interactive fallback
# ============================================================================

@test "resolve: no flags with a TTY reports interactive (no hang)" {
    # A TTY is not available inside the bats harness; simulate the TTY branch
    # by overriding the detector, which is the documented seam for callers.
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        body_source_stdin_is_tty() { return 0; }
        body_source_resolve '' '' </dev/null > '$TEST_TEMP_DIR/out.txt'
        printf 'result=%s\n' \"\$BODY_SOURCE_RESULT\"
        printf 'outbytes=%s\n' \"\$(wc -c < '$TEST_TEMP_DIR/out.txt')\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"result=interactive"* ]]
    [[ "$output" == *"outbytes=0"* ]]
}

# ============================================================================
# body_source_validate_sources Tests
# ============================================================================

@test "validate: zero sources errors" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        BODY_SOURCE_TEXT=''
        BODY_SOURCE_FILE=''
        body_source_validate_sources none
    "
    [ "$status" -eq 2 ]
    [[ "$output" == *"A body source is required"* ]]
}

@test "validate: exactly one source passes" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        BODY_SOURCE_TEXT='hello'
        BODY_SOURCE_FILE=''
        body_source_validate_sources none && echo 'ok'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"ok"* ]]
}

@test "validate: extra mode counts as a source" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        BODY_SOURCE_TEXT=''
        BODY_SOURCE_FILE=''
        body_source_validate_sources edit
    "
    [ "$status" -eq 0 ]
}

@test "validate: two sources conflict" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        BODY_SOURCE_TEXT='hello'
        BODY_SOURCE_FILE='/tmp/x.md'
        body_source_validate_sources none
    "
    [ "$status" -eq 2 ]
    [[ "$output" == *"Only one body source"* ]]
}

@test "validate: three sources conflict" {
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        BODY_SOURCE_TEXT='hello'
        BODY_SOURCE_FILE='/tmp/x.md'
        body_source_validate_sources edit
    "
    [ "$status" -eq 2 ]
    [[ "$output" == *"Only one body source"* ]]
}

# ============================================================================
# body_source_capture_stdin Tests (tech-debt plan: F001 defect signal)
# ============================================================================

@test "capture: prints content to stdout for piped stdin (F001 fixed)" {
    printf 'PROBE-BODY-CONTENT\n' > "$TEST_TEMP_DIR/in.txt"
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        out=\$(body_source_capture_stdin < '$TEST_TEMP_DIR/in.txt')
        printf 'stdout_len=%s\n' "\${#out}"
        printf 'stdout=%s\n' "\$out"
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"stdout_len=18"* ]]
    [[ "$output" == *"stdout=PROBE-BODY-CONTENT"* ]]
}

@test "capture: empty stdin errors rc=2" {
    : > "$TEST_TEMP_DIR/in.txt"
    run bash -c "
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        body_source_capture_stdin < '$TEST_TEMP_DIR/in.txt'
    "
    [ "$status" -eq 2 ]
}
