#!/usr/bin/env bats
# CLI apply-mode tests for the triage tool. gh is stubbed; config is real
# (devenv.config [workflows] supplies the vocabulary).

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    SCRIPT="$PROJECT_ROOT/tools/scripts/issue-triage.sh"
    stub_dir="$(mktemp -d)"
    export STUB_DIR="$stub_dir"
    # gh stub: auth passes; issue edits record; project ops are no-ops.
    cat > "$stub_dir/gh" <<STUB
#!/usr/bin/env bash
echo "gh \$*" >> "$stub_dir/calls.log"
case "\$1 \$2" in
    "auth status") exit 0 ;;
    "issue edit") exit 0 ;;
    *) exit 0 ;;
esac
STUB
    chmod +x "$stub_dir/gh"
    export PATH="$stub_dir:$PATH"
    export GITHUB_REPO="test-org/test-repo"
    unset GH_ORG
}

@test "CLI mode: no bundle options is an error" {
    run bash "$SCRIPT" 44
    [ "$status" -ne 0 ]
}

@test "CLI mode: non-numeric positional is rejected" {
    run bash "$SCRIPT" notanumber --label bug
    [ "$status" -ne 0 ]
    [[ "$output" == *"Unknown option"* ]]
}

@test "CLI mode: --label applies via gh issue edit" {
    run bash "$SCRIPT" 44 --label bug
    [ "$status" -eq 0 ]
    grep -q "issue edit.*--add-label bug" "$STUB_DIR/calls.log"
}

@test "CLI mode: bundle of label + assignee applies both in one call" {
    run bash "$SCRIPT" 44 --label bug --label "priority: high" --assignee someuser
    [ "$status" -eq 0 ]
    [ "$(grep -c "add-label" "$STUB_DIR/calls.log")" -eq 2 ]
    grep -q "add-assignee someuser" "$STUB_DIR/calls.log"
}

@test "CLI mode: --triage-complete fires the event entry point for the issue" {
    # The event signal goes through tools/scripts/_on_triage_complete.sh
    # -> dispatcher -> wrapper; under a no-op gh stub the observable is the
    # wrapper's reverse-lookup call for the target issue.
    run bash "$SCRIPT" 44 --triage-complete
    [ "$status" -eq 0 ]
    grep -q "issues/44" "$STUB_DIR/calls.log"
}

@test "CLI mode: bulk - multiple issue numbers each get the bundle" {
    run bash "$SCRIPT" 44 45 --label bug
    [ "$status" -eq 0 ]
    [ "$(grep -c "add-label bug" "$STUB_DIR/calls.log")" -eq 2 ]
}
