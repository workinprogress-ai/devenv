#!/usr/bin/env bats
# Tests for the workflow-core interface contracts (workflow_on_event,
# workflow_apply_status, workflow_recompute_parent). Stubbed gh + issue-graph;
# assertions are on argv contracts and exit codes.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    LIB="$PROJECT_ROOT/tools/lib/workflow-core.bash"
    GRAPH="$PROJECT_ROOT/tools/lib/issue-graph.bash"
    stub_dir="$(mktemp -d)"
    export STUB_DIR="$stub_dir"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$stub_dir/gh"
    chmod +x "$stub_dir/gh"
    export PATH="$stub_dir:$PATH"
    export DEVENV_REPO="test-org/test-repo"
    unset GH_ORG
}

@test "usage error when on_event called without event or issue" {
    run bash -c "source '$LIB' && workflow_on_event"
    [ "$status" -ne 0 ]
    run bash -c "source '$LIB' && workflow_on_event _on_merge"
    [ "$status" -ne 0 ]
}

@test "unknown event: warn + exit 0 (best-effort tolerance)" {
    run bash -c "source '$LIB' && workflow_on_event _on_bogus 44"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Unknown event"* || "$output" == *"unknown"* ]]
}

@test "on_event resolves configured event and invokes the write path" {
    # Assert on what the fan-out wrapper was actually asked to write: the
    # resolved status token of the configured event, for the given issue. The
    # WORKFLOW_CORE_TOOLS seam swaps only where the wrapper is found.
    local wf="$STUB_DIR/wf/scripts"
    mkdir -p "$wf"
    cat > "$wf/project-update-issue.sh" <<STUB
#!/usr/bin/env bash
echo "WF-WRITE \$*" >> "$STUB_DIR/calls.log"
exit 0
STUB
    chmod +x "$wf/project-update-issue.sh"
    : > "$STUB_DIR/calls.log"
    run bash -c "source '$LIB' && WORKFLOW_CORE_TOOLS='$STUB_DIR/wf' workflow_on_event _on_begin_grooming 44"
    [ "$status" -eq 0 ]
    grep -qx "WF-WRITE 44 --status To-Groom --all-projects --safe" "$STUB_DIR/calls.log"
}

@test "on_event for an unknown event performs no write" {
    local wf="$STUB_DIR/wf/scripts"
    mkdir -p "$wf"
    printf '#!/usr/bin/env bash\necho "WF-WRITE $*" >> "%s/calls.log"\n' "$STUB_DIR" > "$wf/project-update-issue.sh"
    chmod +x "$wf/project-update-issue.sh"
    : > "$STUB_DIR/calls.log"
    run bash -c "source '$LIB' && WORKFLOW_CORE_TOOLS='$STUB_DIR/wf' workflow_on_event _on_bogus 44"
    [ "$status" -eq 0 ]
    [ ! -s "$STUB_DIR/calls.log" ]
}

@test "apply_status without status is a usage error" {
    run bash -c "source '$LIB' && workflow_apply_status 44"
    [ "$status" -ne 0 ]
}

@test "apply_status with gated state rejects forcing" {
    run bash -c "source '$LIB' && workflow_apply_status 44 Ready parent"
    [ "$status" -ne 0 ]
    [[ "$output" == *"cannot be forced"* || "$output" == *"gated"* ]]
}

@test "apply_status delivery-state parent write succeeds and cascades once" {
    # Stub the write path; assert the function returns 0. Cascade fan count
    # is covered by the propagation tests in the rollup suite; here: contract
    # only.
    run bash -c "source '$LIB' && workflow_apply_status 44 Production parent"
    [ "$status" -eq 0 ]
}

@test "recompute_parent with no parent: clean no-op exit 0" {
    run bash -c "source '$LIB' && workflow_recompute_parent 44"
    [ "$status" -eq 0 ]
}

@test "cascade: write failure on a child does not stop the fan-out (best-effort)" {
    # The choke point warns and returns 0 on a failed write; the cascade
    # must still attempt every remaining child.
    local wf="$STUB_DIR/wf/scripts"
    mkdir -p "$wf"
    cat > "$wf/project-update-issue.sh" <<STUB
#!/usr/bin/env bash
echo "WF-WRITE \$*" >> "$STUB_DIR/calls.log"
[ "\$1" = "48" ] && exit 1
exit 0
STUB
    chmod +x "$wf/project-update-issue.sh"
    # jq-aware gh stub: answers the subIssues query with three children so
    # the real issue-graph reader drives the cascade.
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
jq_program=""
prev=""
for arg in "$@"; do
    if [ "$prev" = "--jq" ]; then jq_program="$arg"; fi
    prev="$arg"
done
payload='{"data":{"repository":{"issue":{"subIssues":{"nodes":[{"number":47},{"number":48},{"number":49}]}}}}}'
printf '%s' "$payload" | jq -r "$jq_program"
STUB
    chmod +x "$STUB_DIR/gh"
    : > "$STUB_DIR/calls.log"
    run bash -c "source '$LIB' && WORKFLOW_CORE_TOOLS='$STUB_DIR/wf' workflow_apply_status 44 Production parent"
    [ "$status" -eq 0 ]
    grep -q "WF-WRITE 44 --status Production" "$STUB_DIR/calls.log"
    grep -q "WF-WRITE 47 --status Production" "$STUB_DIR/calls.log"
    grep -q "WF-WRITE 48 --status Production" "$STUB_DIR/calls.log"
    grep -q "WF-WRITE 49 --status Production" "$STUB_DIR/calls.log"
}

@test "cascade: children read failure leaves parent written, no fan-out" {
    # issue_children failing (gh flake) must not block the parent's own
    # write; the cascade is skipped for this call.
    local wf="$STUB_DIR/wf/scripts"
    mkdir -p "$wf"
    cat > "$wf/project-update-issue.sh" <<STUB
#!/usr/bin/env bash
echo "WF-WRITE \$*" >> "$STUB_DIR/calls.log"
exit 0
STUB
    chmod +x "$wf/project-update-issue.sh"
    printf '#!/usr/bin/env bash\nexit 1\n' > "$STUB_DIR/gh"
    chmod +x "$STUB_DIR/gh"
    : > "$STUB_DIR/calls.log"
    run bash -c "source '$LIB' && WORKFLOW_CORE_TOOLS='$STUB_DIR/wf' workflow_apply_status 44 Production parent"
    [ "$status" -eq 0 ]
    grep -q "WF-WRITE 44 --status Production" "$STUB_DIR/calls.log"
    [ "$(grep -c "WF-WRITE" "$STUB_DIR/calls.log")" -eq 1 ]
}

# ============================================================================
# workflow_order must not leave the caller's config selection changed
# ============================================================================

@test "workflow_order leaves the caller's own config file selected" {
    # A wrapper that initialized its own config used to find devenv.config
    # selected after calling anything that reached workflow_order.
    printf '[wrapper]\nkey=mine\n' > "$TEST_TEMP_DIR/own.config"
    run bash -c "
        source '$LIB'
        config_init '$TEST_TEMP_DIR/own.config'
        workflow_order >/dev/null
        config_read_value wrapper key
    "
    [ "$status" -eq 0 ]
    [ "$output" = "mine" ]
}

@test "workflow_order still returns the configured vocabulary" {
    run bash -c "source '$LIB'; workflow_order"
    [ "$status" -eq 0 ]
    [[ "$output" == *"TBD"* ]]
    [[ "$output" == *"Production"* ]]
}

@test "workflow_order leaves CONFIG_FILE unset when the caller had none" {
    run bash -c "
        source '$LIB'
        unset CONFIG_FILE
        workflow_order >/dev/null
        echo \"state=\${CONFIG_FILE+set}\"
    "
    [ "$status" -eq 0 ]
    [ "$output" = "state=" ]
}

@test "workflow_order restores the caller's config even when its own read fails" {
    printf '[wrapper]\nkey=mine\n' > "$TEST_TEMP_DIR/own.config"
    mkdir -p "$TEST_TEMP_DIR/empty-root"
    printf '[other]\nx=1\n' > "$TEST_TEMP_DIR/empty-root/devenv.config"
    run bash -c "
        source '$LIB'
        config_init '$TEST_TEMP_DIR/own.config'
        DEVENV_ROOT='$TEST_TEMP_DIR/empty-root' workflow_order >/dev/null 2>&1 || true
        config_read_value wrapper key
    "
    [ "$status" -eq 0 ]
    [ "$output" = "mine" ]
}

@test "workflow_order with an override does not touch the caller's config" {
    printf '[wrapper]\nkey=mine\n' > "$TEST_TEMP_DIR/own.config"
    run bash -c "
        source '$LIB'
        config_init '$TEST_TEMP_DIR/own.config'
        WORKFLOW_ORDER_OVERRIDE='A,B,C' workflow_order
        echo
        config_read_value wrapper key
    "
    [ "$status" -eq 0 ]
    [ "$output" = $'A B C\nmine' ]
}
