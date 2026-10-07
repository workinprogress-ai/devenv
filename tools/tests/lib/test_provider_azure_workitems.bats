#!/usr/bin/env bats
# Azure work items: the devenv-type to Azure-type map, the markdown description
# format, tag handling on edit, comment paging, type changes, and the board-column
# status (read back and written). Shapes are the recorded ones where a recording
# exists (tools/tests/fixtures/azure/); the rest follow the documented API shape.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

FIXTURES="$BATS_TEST_DIRNAME/../fixtures/azure"

setup() {
    test_helper_setup
    stub_curl
    export STUB_CALL_LOG
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$DEVENV_ROOT"
    export AZURE_PAT="test-pat"
    export AZURE_PAT_FILE="$TEST_TEMP_DIR/azure.pat"
    printf 'test-pat\n' > "$AZURE_PAT_FILE"
    chmod 600 "$AZURE_PAT_FILE"
    printf '[provider]\nname=azure\nazure_org=org\nazure_project=proj\n' > "$DEVENV_ROOT/devenv.config"
    export REQ_BODIES="$TEST_TEMP_DIR/request-bodies.log"
    : > "$REQ_BODIES"
}

teardown() {
    unset AZURE_PAT AZURE_PAT_FILE DEVENV_ROOT
    test_helper_teardown
}

azure_libs_source() {
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    PROVIDER_NAME=azure
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/issues.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/projects.bash"
}
azure_run() {
    azure_libs_source
    "$@"
}

page_queue() { : > "$TEST_TEMP_DIR/pages.queue"; local f; for f in "$@"; do printf '%s\n' "$f" >> "$TEST_TEMP_DIR/pages.queue"; done; }

# ---------------------------------------------------------------------------
# The type map
# ---------------------------------------------------------------------------

@test "azure_work_item_type_for: Epic, Feature and Bug are native; Task and untyped are User Story" {
    local t
    for t in "Epic:Epic" "Feature:Feature" "Bug:Bug" "Task:User Story" ":User Story" "bug:Bug"; do
        run azure_run azure_work_item_type_for "${t%%:*}"
        [ "$status" -eq 0 ]
        [ "$output" = "${t#*:}" ] || { echo "${t%%:*} -> $output"; return 1; }
    done
}

@test "azure_work_item_type_for: an [azure_issue_types] entry in devenv.config overrides the built-in map" {
    printf '[azure_issue_types]\ntask=Task\nspike=Feature\n' >> "$DEVENV_ROOT/devenv.config"
    run azure_run azure_work_item_type_for Task
    [ "$output" = "Task" ]
    run azure_run azure_work_item_type_for Spike
    [ "$status" -eq 0 ]
    [ "$output" = "Feature" ]
}

@test "azure_work_item_type_for: an unmapped type fails and says how to map it" {
    run azure_run azure_work_item_type_for Story
    [ "$status" -ne 0 ]
    [[ "$output" == *"[azure_issue_types]"* ]]
}

@test "provider_issues_create --type Bug creates the item as a Bug" {
    printf '{"id":301}' > "$TEST_TEMP_DIR/created.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/created.json" run azure_run provider_issues_create --title "Broken" --type Bug
    [ "$status" -eq 0 ]
    grep -q 'workitems/\$Bug' "$STUB_CALL_LOG"
}

@test "provider_issues_create stores the description with the markdown multiline format" {
    printf '{"id":301}' > "$TEST_TEMP_DIR/created.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/created.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_issues_create --title "T" --body "# heading"
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[][]?; .path == "/multilineFieldsFormat/System.Description" and .value == "markdown")' "$REQ_BODIES" >/dev/null
}

@test "provider_issues_list --type maps the devenv type onto the Azure type in the query" {
    printf '{"workItems":[]}' > "$TEST_TEMP_DIR/none.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/none.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_issues_list --type Task
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[]; (.query // "") | contains("[System.WorkItemType] = '"'"'User Story'"'"'"))' "$REQ_BODIES" >/dev/null
}

@test "provider_issues_set_type leaves an item that already has the mapped type alone" {
    printf '{"id":101,"fields":{"System.WorkItemType":"User Story"}}' > "$TEST_TEMP_DIR/story.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/story.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_issues_set_type o r 101 Task
    [ "$status" -eq 0 ]
    [ ! -s "$REQ_BODIES" ]
}

@test "provider_issues_set_type changes the type to the mapped Azure type" {
    printf '{"id":101,"fields":{"System.WorkItemType":"User Story"}}' > "$TEST_TEMP_DIR/story.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/story.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_issues_set_type o r 101 Bug
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[][]?; .path == "/fields/System.WorkItemType" and .value == "Bug")' "$REQ_BODIES" >/dev/null
}

# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------

@test "provider_issues_list trims the space Azure puts after each tag separator" {
    printf '{"workItems":[{"id":101}]}' > "$TEST_TEMP_DIR/wiql.json"
    printf '{"value":[{"id":101,"fields":{"System.Title":"t","System.State":"Active","System.Tags":"a; b;c"}}]}' > "$TEST_TEMP_DIR/details.json"
    page_queue "$TEST_TEMP_DIR/wiql.json" "$TEST_TEMP_DIR/details.json"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" run azure_run provider_issues_list --state all
    [ "$status" -eq 0 ]
    [ "$(jq -c '[.[0].labels[].name]' <<< "$output")" = '["a","b","c"]' ]
}

@test "provider_issues_add_tag appends a new tag to the trimmed existing ones" {
    STUB_CURL_RESPONSE="$FIXTURES/workitem.tags.two.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_issues_add_tag 101 extra
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[][]?; .path == "/fields/System.Tags" and .value == "smoke-tag; smoke-tag-2; extra")' "$REQ_BODIES" >/dev/null
}

@test "provider_issues_edit --remove-label for a tag the item does not carry sends nothing" {
    STUB_CURL_RESPONSE="$FIXTURES/workitem.tags.two.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_issues_edit "" 101 --remove-label never-there
    [ "$status" -eq 0 ]
    [ ! -s "$REQ_BODIES" ]
}

@test "provider_issues_edit removes the last tag by removing the field" {
    printf '{"id":101,"fields":{"System.Tags":"only"}}' > "$TEST_TEMP_DIR/one.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/one.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_issues_edit "" 101 --remove-label only
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[][]?; .op == "remove" and .path == "/fields/System.Tags")' "$REQ_BODIES" >/dev/null
}

@test "provider_issues_edit applies --remove-label and --add-label together in one write" {
    STUB_CURL_RESPONSE="$FIXTURES/workitem.tags.two.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_issues_edit "" 101 --remove-label smoke-tag --add-label fresh
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[][]?; .path == "/fields/System.Tags" and .value == "smoke-tag-2; fresh")' "$REQ_BODIES" >/dev/null
}

@test "provider_issues_edit refuses an option Azure has no write path for, instead of dropping it" {
    run azure_run provider_issues_edit "" 101 --milestone 7
    [ "$status" -ne 0 ]
    [[ "$output" == *"--milestone"* ]]
    [[ "$output" == *"not supported"* ]]
}

@test "provider_issues_edit reads a body from stdin with --body-file -" {
    printf '{"id":101}' > "$TEST_TEMP_DIR/ok.json"
    azure_libs_source
    printf 'body from stdin\n' | STUB_CURL_RESPONSE="$TEST_TEMP_DIR/ok.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" provider_issues_edit "" 101 --body-file -
    jq -s -e 'any(.[][]?; .path == "/fields/System.Description" and .value == "body from stdin")' "$REQ_BODIES" >/dev/null
    jq -s -e 'any(.[][]?; .path == "/multilineFieldsFormat/System.Description")' "$REQ_BODIES" >/dev/null
}

# ---------------------------------------------------------------------------
# Comments page past one response
# ---------------------------------------------------------------------------

@test "provider_issues_comments follows the continuation token to the last page" {
    printf '{"comments":[{"id":1,"workItemId":42,"text":"one","createdBy":{"displayName":"A"},"createdDate":"d"}],"continuationToken":"tok 1"}' > "$TEST_TEMP_DIR/c1.json"
    printf '{"comments":[{"id":2,"workItemId":42,"text":"two","createdBy":{"displayName":"A"},"createdDate":"d"}]}' > "$TEST_TEMP_DIR/c2.json"
    page_queue "$TEST_TEMP_DIR/c1.json" "$TEST_TEMP_DIR/c2.json"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" run azure_run provider_issues_comments "" 42
    [ "$status" -eq 0 ]
    [ "$(jq -c '[.[].id]' <<< "$output")" = '["42/1","42/2"]' ]
    grep -q 'continuationToken=tok%201' "$STUB_CALL_LOG"
}

@test "provider_issues_comment_get finds a comment that is on a later page" {
    printf '{"comments":[{"id":1,"workItemId":42,"text":"one"}],"continuationToken":"t"}' > "$TEST_TEMP_DIR/c1.json"
    printf '{"comments":[{"id":2,"workItemId":42,"text":"two"}]}' > "$TEST_TEMP_DIR/c2.json"
    page_queue "$TEST_TEMP_DIR/c1.json" "$TEST_TEMP_DIR/c2.json"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" run azure_run provider_issues_comment_get "" 42/2
    [ "$status" -eq 0 ]
    [ "$(jq -r '.body' <<< "$output")" = "two" ]
}

# ---------------------------------------------------------------------------
# Status: the Kanban column
# ---------------------------------------------------------------------------

@test "provider_projects_for_issue reads every workflow word back as itself" {
    local word
    for word in TBD To-Groom Ready Implementing Review Merged Staging Production; do
        STUB_CURL_RESPONSE="$FIXTURES/kanban.column.$word.json" run azure_run provider_projects_for_issue "https://dev.azure.com/org/proj/_workitems/edit/101" ""
        [ "$status" -eq 0 ]
        [ "$(printf '%s' "$output" | cut -f3)" = "$word" ] || { echo "$word read back as: $output"; return 1; }
    done
}

@test "provider_projects_for_issue names the board of the item's type" {
    STUB_CURL_RESPONSE="$FIXTURES/kanban.column.Review.json" run azure_run provider_projects_for_issue "https://dev.azure.com/org/proj/_workitems/edit/101" ""
    [ "$(printf '%s' "$output" | cut -f1)" = "Stories" ]
}

@test "provider_projects_for_issue reports the state of an item whose type has no board" {
    printf '{"id":5,"fields":{"System.State":"Active","System.WorkItemType":"Issue"}}' > "$TEST_TEMP_DIR/issue.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/issue.json" run azure_run provider_projects_for_issue "https://dev.azure.com/org/proj/_workitems/edit/5" ""
    [ "$(printf '%s' "$output" | cut -f3)" = "Active" ]
}

@test "the wrapper path sets and reads back each workflow word: option_ids, field_set, for_issue" {
    local word
    for word in TBD To-Groom Ready Implementing Review Merged Staging Production; do
        : > "$REQ_BODIES"
        run azure_run provider_projects_field_option_ids pid Status "$word"
        [ "$status" -eq 0 ]
        local option; option="$(printf '%s' "$output" | cut -f2)"
        STUB_CURL_RESPONSE="$FIXTURES/kanban.column.$word.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
            run azure_run provider_projects_field_set pid 101 Status "$option"
        [ "$status" -eq 0 ]
        jq -s -e --arg w "$word" 'any(.[][]?; (.path | test("_Kanban\\.Column$")) and .value == $w)' "$REQ_BODIES" >/dev/null
        STUB_CURL_RESPONSE="$FIXTURES/kanban.column.$word.json" run azure_run provider_projects_for_issue "https://dev.azure.com/org/proj/_workitems/edit/101" ""
        [ "$(printf '%s' "$output" | cut -f3)" = "$word" ]
    done
}

@test "provider_projects_field_option_ids maps a fork-local word through [azure_status_aliases]" {
    printf '[azure_status_aliases]\nDoing=Implementing\n' >> "$DEVENV_ROOT/devenv.config"
    run azure_run provider_projects_field_option_ids pid Status Doing
    [ "$status" -eq 0 ]
    [ "$output" = "$(printf 'Status\tImplementing')" ]
}

@test "azure_issue_patch_state builds valid JSON for a state name containing a quote" {
    printf '{"id":1}' > "$TEST_TEMP_DIR/ok.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/ok.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" run azure_run azure_issue_patch_state 1 'Won"t Fix'
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[][]?; .path == "/fields/System.State" and .value == "Won\"t Fix")' "$REQ_BODIES" >/dev/null
}

# An item with no tags yet has no System.Tags field at all; the first tag must still be written.
@test "provider_issues_add_tag writes the first tag of an item that has none" {
    printf '{"id":1,"fields":{}}' > "$TEST_TEMP_DIR/untagged.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/untagged.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" run azure_run provider_issues_add_tag 1 first
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[][]?; .path == "/fields/System.Tags" and .value == "first")' "$REQ_BODIES" >/dev/null
}

@test "azure_tags_split of an empty or blank string is an empty array" {
    run azure_run azure_tags_split ""
    [ "$output" = "[]" ]
    run azure_run azure_tags_split " ; ;"
    [ "$output" = "[]" ]
}

# ---------------------------------------------------------------------------
# An option the verb cannot honor is an error, not a silently different result
# ---------------------------------------------------------------------------

@test "provider_issues_list refuses --assignee: dropping the filter would list the wrong issues" {
    run azure_run provider_issues_list --assignee someone
    [ "$status" -ne 0 ]
    [[ "$output" == *"--assignee"* ]]
    [ ! -s "$STUB_CALL_LOG" ] || [ "$(grep -c '^curl ' "$STUB_CALL_LOG")" -eq 0 ]
}

@test "provider_issues_list refuses --milestone, --author and --mention too" {
    local flag
    for flag in --milestone --author --mention; do
        run azure_run provider_issues_list "$flag" x
        [ "$status" -ne 0 ] || { echo "accepted $flag"; return 1; }
        [[ "$output" == *"$flag"* ]]
    done
}
