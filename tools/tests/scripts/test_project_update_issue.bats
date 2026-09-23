#!/usr/bin/env bats
# Characterization tests for project-update-issue.sh current behavior.
# Lock the observable contract of the v1.0.0 stub before the write path is
# implemented: validation against the configured workflow, arg handling,
# and stub output shape. The write path evolves these deliberately.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    # Stub gh so check_dependencies passes and no live API is touched;
    # each test may override for call-shape assertions.
    stub_dir="$(mktemp -d)"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$stub_dir/gh"
    chmod +x "$stub_dir/gh"
    export PATH="$stub_dir:$PATH"
    STUB_DIR="$stub_dir"
    SCRIPT="$PROJECT_ROOT/tools/scripts/project-update-issue.sh"
    # Deterministic repo targeting per the wrapper's documented env contract:
    # the suite environment must not leak GH_ORG/GITHUB_REPO either way.
    export GITHUB_REPO="test-org/test-repo"
    unset GH_ORG
}

@test "usage error when no arguments given" {
    run bash "$SCRIPT"
    [ "$status" -ne 0 ]
}

@test "usage error when only a status is given" {
    run bash "$SCRIPT" someproject --status "Ready"
    [ "$status" -ne 0 ]
}

@test "invalid status is rejected against configured workflow" {
    run bash "$SCRIPT" someproject 123 --status "Bogus"
    [ "$status" -ne 0 ]
    [[ "$output" == *"Invalid status"* ]]
}

@test "single-project write: not-in-project reports a clean error (write path)" {
    # The stubbed gh reports the issue is absent from the project; the
    # wrapper must fail cleanly rather than print manual instructions.
    run bash "$SCRIPT" someproject 123 --status "Ready"
    [ "$status" -ne 0 ]
    [[ "$output" == *"not found"* || "$output" == *"not in project"* || "$output" == *"Failed to set"* ]]
}

@test "dry-run reports intent without contacting GitHub" {
    run bash "$SCRIPT" someproject 123 --status "To-Groom" --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"[DRY RUN]"* ]]
}

@test "rejects status values not in the configured workflow" {
    # The hyphenated 8-state kanban is canonical; legacy values must fail.
    run bash "$SCRIPT" someproject 123 --status "Done" --dry-run
    [ "$status" -ne 0 ]
    [[ "$output" == *"Invalid status"* ]]
}

@test "hyphenated multi-word status validates (comma-normalized config reader)" {
    # Guards the comma-split fix: hyphenated tokens must validate intact.
    run bash "$SCRIPT" someproject 123 --status "To-Groom" --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"[DRY RUN]"* ]]
    [[ "$output" == *"To-Groom"* ]]
}

@test "spaced status strings are rejected by vocabulary validation" {
    # Vocabulary is hyphenated single tokens; spaced form must not validate.
    run bash "$SCRIPT" someproject 123 --status "To Groom" --dry-run
    [ "$status" -ne 0 ]
}

@test "list-fields surfaces gh project field-list output" {
    # Replace the bare stub with a recording one to assert the call shape.
    cat > "$STUB_DIR/gh" <<'EOF'
#!/usr/bin/env bash
echo "gh-project-field-list-called: $*"
EOF
    chmod +x "$STUB_DIR/gh"
    run bash "$SCRIPT" someproject 123 --list-fields
    [ "$status" -eq 0 ]
    [[ "$output" == *"gh-project-field-list-called"* ]]
}

# --- --field real write path (single-select, via the shared GraphQL helpers) ---

# Install a jq-applying gh stub (the wrapper's field/option resolution filters
# inside the jq program, so a bare exit-0 gh cannot satisfy the real path).
jq_gh_stub() {
    cat > "$STUB_DIR/gh" <<'EOF'
#!/usr/bin/env bash
prog=""
prev=""
for a in "$@"; do
    if [ "$prev" = "--jq" ]; then prog="$a"; fi
    prev="$a"
done
payload=""
case "$*" in
    *"items(first"*)
        payload='{"data":{"node":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVTI_item1","content":{"number":123,"repository":{"nameWithOwner":"test-org/test-repo"}}}]}}}}'
        ;;
    *"projectsV2(first"*)
        payload='{"data":{"organization":{"projectsV2":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVT_test1","number":9,"title":"someproject"}]}}}}'
        ;;
    *"ProjectV2SingleSelectField"*)
        payload='{"data":{"node":{"field":{"id":"PVTVF_f1","options":[{"id":"PVTFO_o1","name":"High"}]}}}}'
        ;;
    *updateProjectV2ItemFieldValue*)
        payload='{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_item1"}}}}'
        ;;
    *"projectV2(number"*)
        payload='{"data":{"organization":{"projectV2":{"id":"PVT_test1"}}}}'
        ;;
    *)
        payload='{"data":{}}'
        ;;
esac
if [ -n "$prog" ]; then
    printf '%s' "$payload" | jq -r "$prog"
else
    echo "$payload"
fi
EOF
    chmod +x "$STUB_DIR/gh"
}

@test "--field performs a real single-select write (mutation issued)" {
    jq_gh_stub
    run bash "$SCRIPT" someproject 123 --field "Priority=High"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Set Priority='High'"* ]]
}

@test "--field with unresolvable option fails with named error (never lies)" {
    jq_gh_stub
    # Same stub, but the field has no matching option for the requested value.
    cat > "$STUB_DIR/gh" <<'EOF'
#!/usr/bin/env bash
prog=""
prev=""
for a in "$@"; do
    if [ "$prev" = "--jq" ]; then prog="$a"; fi
    prev="$a"
done
payload='{"data":{}}'
case "$*" in
    *"items(first"*)
        payload='{"data":{"node":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVTI_item1","content":{"number":123,"repository":{"nameWithOwner":"test-org/test-repo"}}}]}}}}'
        ;;
    *"projectsV2(first"*)
        payload='{"data":{"organization":{"projectsV2":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVT_test1","number":9,"title":"someproject"}]}}}}'
        ;;
esac
printf '%s' "$payload" | jq -r "$prog"
EOF
    chmod +x "$STUB_DIR/gh"
    run bash "$SCRIPT" someproject 123 --field "Priority=Nope"
    [ "$status" -ne 0 ]
    [[ "$output" == *"not found"* ]]
}

@test "--field with invalid NAME=VALUE format fails" {
    jq_gh_stub
    run bash "$SCRIPT" someproject 123 --field "NoEqualsSign"
    [ "$status" -ne 0 ]
    [[ "$output" == *"expected NAME=VALUE"* ]]
}

@test "--field combined with --all-projects is rejected" {
    run bash "$SCRIPT" 123 --all-projects --field "Priority=High"
    [ "$status" -ne 0 ]
    [[ "$output" == *"fan-out is Status-only"* ]]
}

@test "failed --status exits non-zero even with a --field queued" {
    # gh stub that fails the project lookup (project not found): the status
    # update fails, and the wrapper must exit 1, not paper over it.
    printf '#!/usr/bin/env bash\nexit 1\n' > "$STUB_DIR/gh"
    chmod +x "$STUB_DIR/gh"
    run bash "$SCRIPT" someproject 123 --status "Ready" --field "Priority=High"
    [ "$status" -ne 0 ]
}

@test "--help documents hyphenated To-Groom vocabulary" {
    run bash "$SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"To-Groom"* ]]
    ! grep -q "To Groom" <<< "$output"
}
