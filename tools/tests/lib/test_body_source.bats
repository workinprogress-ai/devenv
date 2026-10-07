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

# ============================================================================
# Probe timeout: a slow producer is not "empty stdin"
# ============================================================================

# Feed the capture function from a producer that writes after a delay.
delayed_capture() {
    local delay="$1"; shift
    bash -c "
        $*
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        ( sleep $delay; printf 'late body\n' ) | body_source_capture_stdin
    "
}

@test "capture: a producer slower than one second is still read under the default" {
    # The first-byte probe used to give up after 1s and call a slow producer
    # (a gh round-trip, a generator behind fzf) empty stdin.
    run delayed_capture 2 ""
    [ "$status" -eq 0 ]
    [ "$output" = "late body" ]
}

@test "capture: BODY_SOURCE_PROBE_TIMEOUT shortens the wait and the slow producer is refused" {
    run delayed_capture 3 "export BODY_SOURCE_PROBE_TIMEOUT=1"
    [ "$status" -eq 2 ]
    [[ "$output" == *"Refusing empty stdin body"* ]]
}

@test "capture: BODY_SOURCE_PROBE_TIMEOUT lengthens the wait" {
    run delayed_capture 2 "export BODY_SOURCE_PROBE_TIMEOUT=4"
    [ "$status" -eq 0 ]
    [ "$output" = "late body" ]
}

@test "capture: an invalid BODY_SOURCE_PROBE_TIMEOUT falls back to the default" {
    run delayed_capture 2 "export BODY_SOURCE_PROBE_TIMEOUT=soon"
    [ "$status" -eq 0 ]
    [ "$output" = "late body" ]
    run delayed_capture 2 "export BODY_SOURCE_PROBE_TIMEOUT=0"
    [ "$status" -eq 0 ]
}

@test "capture: an open but silent pipe is still refused, after the configured wait" {
    # Elapsed time is measured inside the consumer: a pipeline always waits for
    # its producer, so timing the whole command would only measure the producer.
    run bash -c "
        export BODY_SOURCE_PROBE_TIMEOUT=1
        source '$PROJECT_ROOT/tools/lib/body-source.bash'
        ( sleep 4 ) | {
            start=\$SECONDS
            body_source_capture_stdin 2>/dev/null
            echo \"rc=\$? elapsed=\$((SECONDS - start))\"
        }
    "
    [ "$status" -eq 0 ]
    [[ "$output" == "rc=2 elapsed=1" || "$output" == "rc=2 elapsed=2" ]]
}

# ---------------------------------------------------------------------------
# --body-file - goes through the same empty-stdin refusal as every other stdin read
# ---------------------------------------------------------------------------

@test "body_source_resolve: --body-file - with empty stdin is refused" {
  run bash -c "source '$PROJECT_ROOT/tools/lib/body-source.bash'; printf '' | body_source_resolve '' -"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Refusing empty stdin body"* ]]
}

@test "body_source_resolve: --body-file - with whitespace-only stdin is refused" {
  run bash -c "source '$PROJECT_ROOT/tools/lib/body-source.bash'; printf '  \n\t\n' | body_source_resolve '' -"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Refusing empty stdin body"* ]]
}

@test "body_source_resolve: --body-file - with content returns it and reports stdin" {
  run bash -c "source '$PROJECT_ROOT/tools/lib/body-source.bash'; printf 'hello\n' | { body_source_resolve '' - ; echo \"src=\$BODY_SOURCE_RESULT\"; }"
  [ "$status" -eq 0 ]
  [[ "$output" == *"hello"* ]]
}

@test "body_source_read_dash refuses a terminal" {
  # no controlling terminal under bats: simulate by overriding the TTY probe
  run bash -c "source '$PROJECT_ROOT/tools/lib/body-source.bash'; body_source_stdin_is_tty() { return 0; }; body_source_read_dash"
  [ "$status" -eq 2 ]
  [[ "$output" == *"requires piped stdin"* ]]
}

@test "body_source_read_dash reads piped content and refuses empty content" {
  run bash -c "source '$PROJECT_ROOT/tools/lib/body-source.bash'; printf 'x y\n' | body_source_read_dash"
  [ "$status" -eq 0 ]
  [ "$output" = "x y" ]
  run bash -c "source '$PROJECT_ROOT/tools/lib/body-source.bash'; printf '' | body_source_read_dash"
  [ "$status" -eq 2 ]
}

@test "issue-artifact-upsert: --body-file - with empty stdin is refused rather than posting an empty comment" {
  local fn; fn="$(sed -n '/^load_comment_body()/,/^}/p' "$PROJECT_ROOT/tools/scripts/issue-artifact-upsert.sh")"
  run bash -c "
    source '$PROJECT_ROOT/tools/lib/error-handling.bash'
    source '$PROJECT_ROOT/tools/lib/body-source.bash'
    COMMENT_FILE=-; COMMENT_BODY=''
    $fn
    printf '' | load_comment_body
  "
  [ "$status" -ne 0 ]
  [[ "$output" == *"Refusing empty stdin body"* ]]
}
