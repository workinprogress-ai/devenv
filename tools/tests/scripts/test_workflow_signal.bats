#!/usr/bin/env bats
# workflow-signal CLI tests: parsing, batching, name normalization,
# dispatch pass-through. Entry points stubbed via a fake tools tree.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    SCRIPT="$PROJECT_ROOT/tools/scripts/workflow-signal.sh"
    FAKE="$TEST_TEMP_DIR/tools"
    mkdir -p "$FAKE/scripts"
    for ev in _on_staging_deploy _on_production_deploy _on_begin_review; do
        printf '#!/usr/bin/env bash\necho "DISPATCH %s $1" >> "%s/log"\n' "$ev" "$FAKE" > "$FAKE/scripts/$ev.sh"
        chmod +x "$FAKE/scripts/$ev.sh"
    done
}

@test "--list exposes every configured event with an executable script" {
    # The command surface is the configured event set: each skill-events.yml
    # event must have an executable backing script in tools/scripts/ (no
    # depth-1 tools/ entries exist for them by contract), and --list must
    # advertise exactly that set.
    local configured ev listed
    configured="$(bash -c "source '$PROJECT_ROOT/tools/lib/skill-events.bash' && event_names")"
    [ -n "$configured" ]
    while IFS= read -r ev; do
        [ -x "$PROJECT_ROOT/tools/scripts/$ev.sh" ] || {
            fail "configured event '$ev' has no executable script (tools/scripts/$ev.sh missing)"
        }
    done <<< "$configured"
    run bash "$SCRIPT" --list
    [ "$status" -eq 0 ]
    listed="$(printf '%s\n' "$output" | sort)"
    [ "$listed" = "$(printf '%s\n' "$configured" | sort)" ]
}

@test "bare event name is normalized to _on_<name>" {
    run env WORKFLOW_SIGNAL_TOOLS="$FAKE/scripts" bash "$SCRIPT" staging-deploy 101
    [ "$status" -eq 0 ]
    grep -q "DISPATCH _on_staging_deploy 101" "$FAKE/log"
}

@test "underscores accepted without _on_ prefix" {
    run env WORKFLOW_SIGNAL_TOOLS="$FAKE/scripts" bash "$SCRIPT" begin_review 105
    [ "$status" -eq 0 ]
    grep -q "DISPATCH _on_begin_review 105" "$FAKE/log"
}

@test "full _on_ form passes through unchanged" {
    run env WORKFLOW_SIGNAL_TOOLS="$FAKE/scripts" bash "$SCRIPT" _on_production_deploy 7
    [ "$status" -eq 0 ]
    grep -q "DISPATCH _on_production_deploy 7" "$FAKE/log"
}

@test "batch: multiple issues per event in one call" {
    run env WORKFLOW_SIGNAL_TOOLS="$FAKE/scripts" bash "$SCRIPT" staging-deploy 101 102 103
    [ "$status" -eq 0 ]
    [ "$(grep -c "DISPATCH _on_staging_deploy" "$FAKE/log")" -eq 3 ]
}

@test "mixed batch: repeated event/issue groups" {
    run env WORKFLOW_SIGNAL_TOOLS="$FAKE/scripts" bash "$SCRIPT" staging-deploy 101 production-deploy 105 106
    [ "$status" -eq 0 ]
    grep -q "DISPATCH _on_staging_deploy 101" "$FAKE/log"
    grep -q "DISPATCH _on_production_deploy 105" "$FAKE/log"
    grep -q "DISPATCH _on_production_deploy 106" "$FAKE/log"
}

@test "unknown event is a hard error with normalized name shown" {
    run env WORKFLOW_SIGNAL_TOOLS="$FAKE/scripts" bash "$SCRIPT" bogus-event 1
    [ "$status" -ne 0 ]
    [[ "$output" == *"Unknown event"* ]]
}

@test "issue number before any event is a usage error" {
    run env WORKFLOW_SIGNAL_TOOLS="$FAKE/scripts" bash "$SCRIPT" 101
    [ "$status" -ne 0 ]
    [[ "$output" == *"before any event"* ]]
}

@test "event without issues is a usage error" {
    run env WORKFLOW_SIGNAL_TOOLS="$FAKE/scripts" bash "$SCRIPT" staging-deploy
    [ "$status" -ne 0 ]
}

@test "one failing issue does not block the rest (best-effort batch)" {
    printf '#!/usr/bin/env bash\nexit 1\n' > "$FAKE/scripts/_on_production_deploy.sh"
    chmod +x "$FAKE/scripts/_on_production_deploy.sh"
    run env WORKFLOW_SIGNAL_TOOLS="$FAKE/scripts" bash "$SCRIPT" staging-deploy 101 production-deploy 105 106
    [ "$status" -ne 0 ]
    grep -q "DISPATCH _on_staging_deploy 101" "$FAKE/log"
}

@test "zero args enters interactive mode (fallback menu, scripted input)" {
    # No fzf in test env -> numbered-menu fallback; feed a selection + issues.
    run bash -c "printf '2\n101 102\n' | env WORKFLOW_SIGNAL_TOOLS=\"$FAKE/scripts\" bash \"$SCRIPT\""
    [ "$status" -eq 0 ]
    grep -q "DISPATCH _on_production_deploy 101" "$FAKE/log"
    grep -q "DISPATCH _on_production_deploy 102" "$FAKE/log"
}

@test "interactive cancel (empty selection) exits clean" {
    run bash -c "printf '\n\n' | env WORKFLOW_SIGNAL_TOOLS=\"$FAKE/scripts\" bash \"$SCRIPT\""
    [ "$status" -eq 0 ]
}

@test "interactive out-of-range selection reports invalid choice (not cancelled)" {
    # A typo'd menu number is an input error, not a user cancel: it must
    # exit non-zero and say so, rather than masquerading as "Cancelled."
    run bash -c "printf '99\n' | env WORKFLOW_SIGNAL_TOOLS=\"$FAKE/scripts\" bash \"$SCRIPT\""
    [ "$status" -ne 0 ]
    [[ "$output" == *"Invalid choice"* ]]
    [[ "$output" != *"Cancelled"* ]]
    [ ! -f "$FAKE/log" ]
}

@test "interactive non-numeric selection reports invalid choice" {
    run bash -c "printf 'banana\n' | env WORKFLOW_SIGNAL_TOOLS=\"$FAKE/scripts\" bash \"$SCRIPT\""
    [ "$status" -ne 0 ]
    [[ "$output" == *"Invalid choice"* ]]
    [ ! -f "$FAKE/log" ]
}

@test "interactive empty issue list after event pick exits clean" {
    run bash -c "printf '1\n\n' | env WORKFLOW_SIGNAL_TOOLS=\"$FAKE/scripts\" bash \"$SCRIPT\""
    [ "$status" -eq 0 ]
    [ ! -f "$FAKE/log" ]
}
