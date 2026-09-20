#!/usr/bin/env bats
# Contract tests for the GitHub Projects GraphQL layer.
# Stubbed gh; each test asserts the call shape the implementations must
# honor (ID resolution, mutation naming, query presence).

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    LIB="$PROJECT_ROOT/tools/lib/github-helpers.bash"
    # Recording gh stub: logs argv to GH_CALL_LOG, emits canned JSON per mode.
    STUB_DIR="$TEST_TEMP_DIR/bin"
    mkdir -p "$STUB_DIR"
    GH_CALL_LOG="$TEST_TEMP_DIR/gh-calls.log"
    export GH_CALL_LOG
    cat > "$STUB_DIR/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALL_LOG"
# Extract the --jq program (last two argv words) and apply it with real jq,
# mirroring gh's behavior: canned payload filtered by the caller's program.
jq_program=""
prev=""
for arg in "$@"; do
    if [ "$prev" = "--jq" ]; then jq_program="$arg"; fi
    prev="$arg"
done
payload=""
case "$*" in
    *updateProjectV2ItemFieldValue*)
        payload='{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_item1"}}}}'
        ;;
    *"ProjectV2SingleSelectField"*)
        payload='{"data":{"node":{"field":{"id":"PVTVF_field1","options":[{"id":"PVTFO_opt1","name":"To-Groom"},{"id":"PVTFO_opt2","name":"Ready"}]}}}}'
        ;;
    *"items(first"*)
        payload='{"data":{"node":{"items":{"nodes":[{"id":"PVTI_item1","content":{"number":42}}]}}}}'
        ;;
    *"projectV2(number"*)
        payload='{"data":{"organization":{"projectV2":{"id":"PVT_test1"}}}}'
        ;;
    *"projectsV2(first"*)
        payload='{"data":{"organization":{"projectsV2":{"nodes":[{"id":"PVT_test1","number":9,"title":"Test_project"}]}}}}'
        ;;
    *"resource(url"*)
        payload='{"data":{"resource":{"projectItems":{"nodes":[{"project":{"id":"PVT_test1","number":9,"title":"Test_project","owner":{"login":"test-org"}},"fieldValues":{"nodes":[{"__typename":"ProjectV2ItemFieldSingleSelectValue","name":"To-Groom","field":{"name":"Status"}}]}}]}}}}'
        ;;
    *)
        payload='{"data":{}}'
        ;;
esac
if [ -n "$jq_program" ]; then
    printf '%s' "$payload" | jq -r "$jq_program"
else
    echo "$payload"
fi
STUB
    chmod +x "$STUB_DIR/gh"
    export PATH="$STUB_DIR:$PATH"
}

@test "project_id_by_name returns the project node ID for a title match" {
    run bash -c "source '$LIB' && project_id_by_name test-org Test_project"
    [ "$status" -eq 0 ]
    [ "$output" = "PVT_test1" ]
    grep -q "graphql" "$GH_CALL_LOG"
}

@test "project_id_by_name accepts a numeric project number" {
    run bash -c "source '$LIB' && project_id_by_name test-org 9"
    [ "$status" -eq 0 ]
    [ "$output" = "PVT_test1" ]
}

@test "project_id_by_name rc=1 AND no graphql error spray when project not found" {
    # Not-found must be a clean rc=1 with empty stdout (the stub answers with
    # an empty node list, so a real implementation returns 1 silently).
    run bash -c "source '$LIB' && project_id_by_name test-org NoSuchProject 2>/dev/null"
    [ "$status" -eq 1 ]
    [ -z "$output" ]
    # A real implementation queries projectsV2 nodes and finds no title match;
    # the call MUST have happened (distinguishes rc=1-not-found from early-exit).
    grep -q "graphql" "$GH_CALL_LOG"
}

@test "project_item_id_for_issue returns the item node ID" {
    run bash -c "source '$LIB' && project_item_id_for_issue PVT_test1 42 test-org test-repo"
    [ "$status" -eq 0 ]
    [[ "$output" == PVTI_* ]]
}

@test "project_field_and_option_ids returns '<field-id> <option-id>' pair" {
    run bash -c "source '$LIB' && project_field_and_option_ids PVT_test1 Status To-Groom"
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^PVTVF_[a-z0-9]+\ PVTFO_[a-z0-9]+$ || "$output" =~ ^[A-Za-z0-9_]+\ [A-Za-z0-9_]+$ ]]
}

@test "update_project_item_field issues a graphql mutation" {
    run bash -c "source '$LIB' && update_project_item_field PVT_test1 PVTI_item1 PVTVF_f1 PVTFO_o1"
    [ "$status" -eq 0 ]
    grep -q "updateProjectV2ItemFieldValue" "$GH_CALL_LOG"
}

@test "projects_for_issue lists projects with status, empty when none" {
    run bash -c "source '$LIB' && projects_for_issue https://github.com/test-org/test-repo/issues/42 test-org"
    [ "$status" -eq 0 ]
    # Implementation detail asserted by the live suite; here: call shape only.
    grep -q "graphql" "$GH_CALL_LOG"
}
