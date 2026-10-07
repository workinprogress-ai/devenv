#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

# ============================================================================
# provider_projects_* — the Boards mapping. Research-verified
# shapes: team id is a ROUTE segment; WIT states at plain 7.1;
# System.State is the only write surface.
# ============================================================================

setup() {
    test_helper_setup
    stub_curl
    export STUB_CALL_LOG
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$DEVENV_ROOT"
    export AZURE_PAT="test-pat"
    printf '[provider]\nname=azure\nazure_org=org\nazure_project=proj\n' > "$DEVENV_ROOT/devenv.config"
}

teardown() {
    unset AZURE_PAT DEVENV_ROOT
    test_helper_teardown
}

azure_libs_source() {
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/auth.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/issues.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/projects.bash"
}

# bash -c harness: sourcing inside run's function-call has proven flaky
# for this suite's three-GET chains; the explicit subshell is deterministic.
azure_run() {
    local fn="$1"; shift
    bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        source '$DEVENV_TOOLS/lib/providers/azure/http.bash'
        source '$DEVENV_TOOLS/lib/providers/azure/auth.bash'
        source '$DEVENV_TOOLS/lib/providers/azure/urls.bash'
        source '$DEVENV_TOOLS/lib/providers/azure/repos.bash'
        source '$DEVENV_TOOLS/lib/providers/azure/issues.bash'
        source '$DEVENV_TOOLS/lib/providers/azure/projects.bash'
        $fn "\$@"
    " _ "$@"
}

# The two/three-step resolution chain (projects GUID -> team -> boards)
# rides the stub's STUB_CURL_PAGES queue in order.
queue_responses() {
    export STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue"
    : > "$STUB_CURL_PAGES"
    local f
    for f in "$@"; do
        printf '%s\n' "$f" >> "$STUB_CURL_PAGES"
    done
}

@test "provider_projects_list lists boards with gh-shaped entries" {
    printf '{"value":[{"id":"b1","name":"Stories"},{"id":"b2","name":"Epics"}]}' > "$TEST_TEMP_DIR/boards.json"
    printf '{"id":"guid-proj","name":"proj"}' > "$TEST_TEMP_DIR/projects.json"
    printf '{"value":[{"id":"guid-team","name":"proj Team"}]}' > "$TEST_TEMP_DIR/teams.json"
    queue_responses "$TEST_TEMP_DIR/projects.json" "$TEST_TEMP_DIR/teams.json" "$TEST_TEMP_DIR/boards.json"
    run azure_run provider_projects_list
    [ "$status" -eq 0 ]
    [ "$(printf '%s\n' "$output" | head -1 | jq -r '.name')" = "Stories" ]
}

@test "provider_projects_id_by_name resolves a board by name" {
    printf '{"value":[{"id":"b1","name":"Stories"}]}' > "$TEST_TEMP_DIR/boards.json"
    printf '{"id":"guid-proj","name":"proj"}' > "$TEST_TEMP_DIR/projects.json"
    printf '{"value":[{"id":"guid-team","name":"proj Team"}]}' > "$TEST_TEMP_DIR/teams.json"
    queue_responses "$TEST_TEMP_DIR/projects.json" "$TEST_TEMP_DIR/teams.json" "$TEST_TEMP_DIR/boards.json"
    run azure_run provider_projects_id_by_name org Stories
    [ "$status" -eq 0 ]
    [ "$output" = "b1" ]
}

@test "provider_projects_id_by_name fails defined for an unknown board" {
    printf '{"value":[{"id":"b1","name":"Stories"}]}' > "$TEST_TEMP_DIR/boards.json"
    printf '{"id":"guid-proj","name":"proj"}' > "$TEST_TEMP_DIR/projects.json"
    printf '{"value":[{"id":"guid-team","name":"proj Team"}]}' > "$TEST_TEMP_DIR/teams.json"
    queue_responses "$TEST_TEMP_DIR/projects.json" "$TEST_TEMP_DIR/teams.json" "$TEST_TEMP_DIR/boards.json"
    run azure_run provider_projects_id_by_name org NoSuch
    [ "$status" -ne 0 ]
}

@test "provider_projects_item_add is a no-op success (born on the board)" {
    run azure_run provider_projects_item_add "" 42 "https://dev.azure.com/o/p/workitems/edit/42"
    [ "$status" -eq 0 ]
}

@test "provider_projects_item_id_for_issue returns the work item id" {
    run azure_run provider_projects_item_id_for_issue board-guid 100999 org repo
    [ "$status" -eq 0 ]
    [ "$output" = "100999" ]
}

@test "provider_projects_field_list emits the board columns as the Status options" {
    printf '{"name":"proj","id":"G1"}' > "$TEST_TEMP_DIR/projects.json"
    printf '{"value":[{"id":"T1"}]}' > "$TEST_TEMP_DIR/teams.json"
    printf '{"value":[{"id":"b1","name":"Stories"},{"id":"b2","name":"Features"}]}' > "$TEST_TEMP_DIR/boards.json"
    printf '%s\n%s\n%s\n%s\n%s\n' "$TEST_TEMP_DIR/projects.json" "$TEST_TEMP_DIR/teams.json" "$TEST_TEMP_DIR/boards.json" \
        "$BATS_TEST_DIRNAME/../fixtures/azure/board.columns.Stories.json" "$BATS_TEST_DIRNAME/../fixtures/azure/board.columns.Features.json" > "$TEST_TEMP_DIR/pages.queue"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" run azure_run provider_projects_field_list "" 1
    [ "$status" -eq 0 ]
    [ "$(printf '%s\n' "$output" | jq -r '.option' | tr '\n' ' ')" = "TBD To-Groom Ready Implementing Review Merged Staging Production " ]
}

@test "provider_projects_field_option_ids passes a state word through" {
    printf '{"value":[{"name":"New"},{"name":"Active"},{"name":"Closed"}]}' > "$TEST_TEMP_DIR/states.json"
    run azure_run provider_projects_field_option_ids pid Status Active
    [ "$status" -eq 0 ]
    [ "$output" = "$(printf 'Status\tActive')" ]
}

@test "provider_projects_field_option_ids passes a column word through; the board validates it when it is written" {
    run azure_run provider_projects_field_option_ids pid Status To-Groom
    [ "$status" -eq 0 ]
    [ "$output" = "$(printf 'Status\tTo-Groom')" ]
}

@test "provider_projects_field_option_ids resolves config aliases" {
    printf '{"value":[{"name":"New"},{"name":"Closed"}]}' > "$TEST_TEMP_DIR/states.json"
    printf '[azure_status_aliases]\nTBD=New\n' >> "$DEVENV_ROOT/devenv.config"
    run azure_run provider_projects_field_option_ids pid Status TBD
    [ "$status" -eq 0 ]
    [ "$output" = "$(printf 'Status\tNew')" ]
}

@test "provider_projects_field_set on an item with no board column patches System.State" {
    printf '{"id":42,"fields":{"System.State":"Active","System.WorkItemType":"Issue"}}' > "$TEST_TEMP_DIR/patched.json"
    : > "$TEST_TEMP_DIR/fsbody.log"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/patched.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/fsbody.log" \
        run azure_run provider_projects_field_set pid 42 Status Closed
    [ "$status" -eq 0 ]
    grep -q "System.State" "$TEST_TEMP_DIR/fsbody.log"
}

@test "azure_status_alias exact-state pass-through matches a real tab" {
    # F-SMOKE-2 regression: the framed list must be matched with real tabs
    # (a literal \t in the pattern is read as the character 't'). In-process
    # call: the multi-line states arg must survive as ONE parameter.
    source "$DEVENV_TOOLS/lib/providers/azure/projects.bash"
    states=$(printf 'New\nActive\nClosed')
    run azure_status_alias Active "$states"
    [ "$status" -eq 0 ]
    [ "$output" = "Active" ]
}

@test "the default team lookup resolves the project by the configured value, a name or a GUID" {
    printf '[provider]\nname=azure\nazure_org=org\nazure_project=my proj\n' > "$DEVENV_ROOT/devenv.config"
    printf '{"id":"guid-proj","name":"my proj"}' > "$TEST_TEMP_DIR/project.json"
    printf '{"value":[{"id":"guid-team","name":"T"}]}' > "$TEST_TEMP_DIR/teams.json"
    queue_responses "$TEST_TEMP_DIR/project.json" "$TEST_TEMP_DIR/teams.json"
    run azure_run azure_default_team_id
    [ "$status" -eq 0 ]
    [ "$output" = "guid-team" ]
    grep -q '_apis/projects/my%20proj?' "$STUB_CALL_LOG"
    grep -q '_apis/projects/guid-proj/teams' "$STUB_CALL_LOG"
}
