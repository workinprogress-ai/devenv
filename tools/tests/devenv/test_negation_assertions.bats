#!/usr/bin/env bats
# Guard: in bats, a negated command that is NOT the last statement of a test
# (`! grep -q …`, `! some_function`) never fails the test, so it asserts
# nothing. Such assertions must be written `run ! cmd`, `[[ ! … ]]`, or an
# explicit status check — or be the final statement, where the status counts.

bats_require_minimum_version 1.5.0

load ../test_helper

# negation_offenders <file>...: prints "file:line: text" for each statement-start
# `! cmd` whose next significant line is neither the closing brace of the test
# nor the closing quote of an enclosing multi-line string.
negation_offenders() {
    local f
    for f in "$@"; do
        awk '
            function significant(s) { return s !~ /^[[:space:]]*(#.*)?$/ }
            { lines[NR] = $0 }
            END {
                for (i = 1; i <= NR; i++) {
                    if (lines[i] ~ /^[[:space:]]*![[:space:]]+[^[:space:]]/) {
                        j = i + 1
                        while (j <= NR && !significant(lines[j])) j++
                        if (lines[j] !~ /^\}[[:space:]]*$/ && lines[j] !~ /^[[:space:]]*"[[:space:]]*$/)
                            printf "%s:%d: %s\n", FILENAME, i, lines[i]
                    }
                }
            }
        ' "$f"
    done
}

@test "no test suite has a non-final negated command statement" {
    run negation_offenders "$PROJECT_ROOT"/tools/tests/*/*.bats
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "the guard flags a non-final negation (it is not vacuous)" {
    printf '%s\n' '@test "x" {' '    ! grep -q foo file' '    true' '}' > "$TEST_TEMP_DIR/bad.bats"
    run negation_offenders "$TEST_TEMP_DIR/bad.bats"
    [[ "$output" == *"bad.bats:2:"* ]]
}

@test "the guard accepts a final negation and the enforcing forms" {
    printf '%s\n' '@test "x" {' '    run ! grep -q foo file' '    [[ ! "$output" =~ x ]]' '    ! grep -q foo file' '}' > "$TEST_TEMP_DIR/good.bats"
    run negation_offenders "$TEST_TEMP_DIR/good.bats"
    [ -z "$output" ]
}
