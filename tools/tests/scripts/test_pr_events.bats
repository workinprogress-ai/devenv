#!/usr/bin/env bats
# pr-events.bash library tests (task 7.1/7.2): linked-issue parsing and
# event mapping for the local PR-tool event firing. No GitHub API touched.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    LIB="$PROJECT_ROOT/tools/lib/pr-events.bash"
}

@test "parse: extracts issue numbers from closing keywords" {
    run bash -c "source '$LIB' && pr_events_parse_issues 'Fixes #7, closes #9, resolves: #11'"
    [ "$status" -eq 0 ]
    [ "${lines[0]}" = "11" ]
    [ "${lines[1]}" = "7" ]
    [ "${lines[2]}" = "9" ]
}

@test "parse: deduplicates and caps at 10" {
    run bash -c "source '$LIB' && pr_events_parse_issues 'fixes #1 fixes #1 $(for i in 2 3 4 5 6 7 8 9 10 11 12 13; do printf 'fixes #%d ' $i; done)'"
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | wc -l)" -le 10 ]
}

@test "parse: empty for bodies without closing keywords" {
    run bash -c "source '$LIB' && pr_events_parse_issues 'just some text, refs #5 but no keyword'"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "event mapping: created -> begin_review, merged -> _on_merge" {
    run bash -c "source '$LIB' && pr_events_event_for created"
    [ "$output" = "_on_begin_review" ]
    run bash -c "source '$LIB' && pr_events_event_for merged"
    [ "$output" = "_on_merge" ]
    run bash -c "source '$LIB' && pr_events_event_for bogus"
    [ "$status" -ne 0 ]
}

@test "signal: fires entry point per linked issue (stubbed tools dir)" {
    local tree="$TEST_TEMP_DIR/tree"
    mkdir -p "$tree/lib" "$tree/scripts"
    cp "$LIB" "$tree/lib/"
    printf '#!/usr/bin/env bash\necho "SIGNAL %s $1" >> "%s/signals.log"\n' "_on_begin_review" "$tree" > "$tree/scripts/_on_begin_review.sh"
    chmod +x "$tree/scripts/_on_begin_review.sh"
    run bash -c "source '$tree/lib/pr-events.bash' && pr_events_signal created 'Fixes #7 closes #9'"
    [ "$status" -eq 0 ]
    grep -q "SIGNAL _on_begin_review 7" "$tree/signals.log"
    grep -q "SIGNAL _on_begin_review 9" "$tree/signals.log"
}

@test "signal: best-effort - failing entry point never propagates non-zero" {
    local tree="$TEST_TEMP_DIR/tree"
    mkdir -p "$tree/lib" "$tree/scripts"
    cp "$LIB" "$tree/lib/"
    printf '#!/usr/bin/env bash\nexit 3\n' > "$tree/_on_merge"
    chmod +x "$tree/_on_merge"
    run bash -c "source '$tree/lib/pr-events.bash' && pr_events_signal merged 'Resolves #4'"
    [ "$status" -eq 0 ]
}
