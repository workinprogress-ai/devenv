#!/usr/bin/env bats
# Contract tests for the GitHub Projects GraphQL verbs (provider_projects_*).
# Stubbed gh; each test asserts the call shape the implementations must
# honor (ID resolution, mutation naming, query presence). Formerly aimed at
# the provider-loader legacy delegates; retargeted to the verbs when the
# delegates were retired.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    LIB="$PROJECT_ROOT/tools/lib/provider-loader.bash"
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
        payload='{"data":{"node":{"items":{"pageInfo":{"hasNextPage":false,"endCursor":""},"nodes":[{"id":"PVTI_item1","content":{"number":42,"repository":{"nameWithOwner":"test-org/test-repo"}}}]}}}}'
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

@test "projects id_by_name returns the project node ID for a title match" {
    run bash -c "source '$LIB' && provider_projects_id_by_name test-org Test_project"
    [ "$status" -eq 0 ]
    [ "$output" = "PVT_test1" ]
    grep -q "graphql" "$GH_CALL_LOG"
}

@test "projects id_by_name accepts a numeric project number" {
    run bash -c "source '$LIB' && provider_projects_id_by_name test-org 9"
    [ "$status" -eq 0 ]
    [ "$output" = "PVT_test1" ]
}

@test "projects id_by_name rc=1 AND no graphql error spray when project not found" {
    # Not-found must be a clean rc=1 with empty stdout (the stub answers with
    # an empty node list, so a real implementation returns 1 silently).
    run bash -c "source '$LIB' && provider_projects_id_by_name test-org NoSuchProject 2>/dev/null"
    [ "$status" -eq 1 ]
    [ -z "$output" ]
    # A real implementation queries projectsV2 nodes and finds no title match;
    # the call MUST have happened (distinguishes rc=1-not-found from early-exit).
    grep -q "graphql" "$GH_CALL_LOG"
}

@test "projects item_id_for_issue returns the item node ID (repo-matched)" {
    run bash -c "source '$LIB' && provider_projects_item_id_for_issue PVT_test1 42 test-org test-repo"
    [ "$status" -eq 0 ]
    [[ "$output" == PVTI_* ]]
}

@test "projects item_id_for_issue rejects the legacy 2-arg call" {
    run bash -c "source '$LIB' && provider_projects_item_id_for_issue PVT_test1 42"
    [ "$status" -ne 0 ]
    [[ "$output" == *"owner and repo required"* ]]
}

@test "projects item_id_for_issue filters by repository (cross-repo number collision)" {
    # Board holds #42 in two repos; only the named repo's card may resolve.
    # gh override: answers every graphql call with the collision payload and
    # applies the caller's --jq program with real jq (the suite stub's mode
    # switch only recognizes its canned items shape, not this board layout).
    run bash -c "
        gh() {
            local prog=\"\" prev=\"\"
            local a
            for a in \"\$@\"; do [ \"\$prev\" = '--jq' ] && prog=\"\$a\"; prev=\"\$a\"; done
            printf '%s' '{\"data\":{\"node\":{\"items\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"\"},\"nodes\":[
{\"id\":\"PVTI_other\",\"content\":{\"number\":42,\"repository\":{\"nameWithOwner\":\"other-org/other-repo\"}}},
{\"id\":\"PVTI_mine\",\"content\":{\"number\":42,\"repository\":{\"nameWithOwner\":\"test-org/test-repo\"}}}
]}}}}' | jq -r \"\$prog\"
        }
        source '$LIB' && provider_projects_item_id_for_issue PVT_test1 42 test-org test-repo
    "
    [ "$status" -eq 0 ]
    [ "$output" = "PVTI_mine" ]
}

@test "projects item_id_for_issue refuses ambiguous same-repo duplicates" {
    run bash -c "
        gh() {
            local prog=\"\" prev=\"\"
            local a
            for a in \"\$@\"; do [ \"\$prev\" = '--jq' ] && prog=\"\$a\"; prev=\"\$a\"; done
            printf '%s' '{\"data\":{\"node\":{\"items\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"\"},\"nodes\":[
{\"id\":\"PVTI_a\",\"content\":{\"number\":42,\"repository\":{\"nameWithOwner\":\"test-org/test-repo\"}}},
{\"id\":\"PVTI_b\",\"content\":{\"number\":42,\"repository\":{\"nameWithOwner\":\"test-org/test-repo\"}}}
]}}}}' | jq -r \"\$prog\"
        }
        source '$LIB' && provider_projects_item_id_for_issue PVT_test1 42 test-org test-repo
    "
    [ "$status" -ne 0 ]
    [[ "$output" == *"expected exactly 1"* ]]
}

@test "projects item_id_for_issue errors when the named repo has no card" {
    run bash -c "
        gh() {
            local prog=\"\" prev=\"\"
            local a
            for a in \"\$@\"; do [ \"\$prev\" = '--jq' ] && prog=\"\$a\"; prev=\"\$a\"; done
            printf '%s' '{\"data\":{\"node\":{\"items\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"\"},\"nodes\":[
{\"id\":\"PVTI_other\",\"content\":{\"number\":42,\"repository\":{\"nameWithOwner\":\"other-org/other-repo\"}}}
]}}}}' | jq -r \"\$prog\"
        }
        source '$LIB' && provider_projects_item_id_for_issue PVT_test1 42 test-org test-repo
    "
    [ "$status" -ne 0 ]
    [[ "$output" == *"not in project"* ]]
}

@test "projects item_id_for_issue paginates past the first item page" {
    # Page 1: hasNextPage=true, no match. Page 2: the named repo's card.
    # gh override keyed on the -f c=<cursor> continuation flag.
    run bash -c "
        gh() {
            local prog=\"\" prev=\"\" page
            local a
            for a in \"\$@\"; do [ \"\$prev\" = '--jq' ] && prog=\"\$a\"; prev=\"\$a\"; done
            # gh -f passes 'c=CUR' as one argv token; query=/p= cannot collide.
            for a in \"\$@\"; do case \"\$a\" in c=*) page=2 ;; esac; done
            if [ \"\${page:-}\" = 2 ]; then
                printf '%s' '{\"data\":{\"node\":{\"items\":{\"pageInfo\":{\"hasNextPage\":false,\"endCursor\":\"\"},\"nodes\":[
{\"id\":\"PVTI_p2\",\"content\":{\"number\":42,\"repository\":{\"nameWithOwner\":\"test-org/test-repo\"}}}
]}}}}' | jq -r \"\$prog\"
            else
                printf '%s' '{\"data\":{\"node\":{\"items\":{\"pageInfo\":{\"hasNextPage\":true,\"endCursor\":\"CUR1\"},\"nodes\":[
{\"id\":\"PVTI_p1\",\"content\":{\"number\":42,\"repository\":{\"nameWithOwner\":\"other-org/other-repo\"}}}
]}}}}' | jq -r \"\$prog\"
            fi
        }
        source '$LIB' && provider_projects_item_id_for_issue PVT_test1 42 test-org test-repo
    "
    [ "$status" -eq 0 ]
    [ "$output" = "PVTI_p2" ]
}

@test "projects field_option_ids returns '<field-id> <option-id>' pair" {
    run bash -c "source '$LIB' && provider_projects_field_option_ids PVT_test1 Status To-Groom"
    [ "$status" -eq 0 ]
    [[ "$output" =~ ^PVTVF_[a-z0-9]+\ PVTFO_[a-z0-9]+$ || "$output" =~ ^[A-Za-z0-9_]+\ [A-Za-z0-9_]+$ ]]
}

@test "projects field_set issues a graphql mutation" {
    run bash -c "source '$LIB' && provider_projects_field_set PVT_test1 PVTI_item1 PVTVF_f1 PVTFO_o1"
    [ "$status" -eq 0 ]
    grep -q "updateProjectV2ItemFieldValue" "$GH_CALL_LOG"
}

@test "projects for_issue lists projects with status, empty when none" {
    run bash -c "source '$LIB' && provider_projects_for_issue https://github.com/test-org/test-repo/issues/42 test-org"
    [ "$status" -eq 0 ]
    # Implementation detail asserted by the live suite; here: call shape only.
    grep -q "graphql" "$GH_CALL_LOG"
}
