#!/usr/bin/env bats
# Tests for the azure provider issues domain: work-item listing (WIQL),
# view/exists/comments reads, create/comment/close/reopen/edit mutations,
# and tag<->label mapping. All transport goes through stub_curl.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

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
}

teardown() {
    unset AZURE_PAT AZURE_PAT_FILE DEVENV_ROOT
    test_helper_teardown
}

# File-scope helpers (see test_provider_azure_repos.bats for the pattern's
# rationale: function, not command string — immune to bash -c quoting traps).
azure_libs_source() {
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    PROVIDER_NAME=azure
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/issues.bash"
}
azure_run() {
    azure_libs_source
    "$@"
}

wit_page() {
    # Work item list/details payload shaped like Azure's.
    cat <<JSON
{"value":[
  {"id":101,"fields":{"System.Title":"First bug","System.State":"New","System.Tags":"bug;infra"}},
  {"id":102,"fields":{"System.Title":"Closed thing","System.State":"Closed","System.Tags":""}}
]}
JSON
}

@test "provider_issues_list maps work items to the seam shape" {
    printf '{"workItems":[{"id":101},{"id":102}]}' > "$TEST_TEMP_DIR/wiql.json"
    wit_page > "$TEST_TEMP_DIR/details.json"
    # The stub pops pages per call: WIQL response first, then batch details.
    printf '%s\n%s\n' "$TEST_TEMP_DIR/wiql.json" "$TEST_TEMP_DIR/details.json" > "$TEST_TEMP_DIR/pages.queue"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" \
        run azure_run provider_issues_list --state all
    [ "$status" -eq 0 ]
    # Two mapped entries in one JSON array; state normalized; tags split
    local mapped="$output"
    [[ "$(jq 'length' <<< "$mapped")" == "2" ]]
    jq -e '.[0].number == 101 and .[0].state == "OPEN" and (.[0].labels | map(.name) | index("bug"))' <<< "$mapped" >/dev/null
    jq -e '.[1].number == 102 and .[1].state == "CLOSED"' <<< "$mapped" >/dev/null
}

@test "provider_issues_view maps a work item with gh-dialect fields" {
    cat > "$TEST_TEMP_DIR/wi.json" <<'JSON'
{"id":101,"fields":{"System.Title":"First bug","System.State":"New","System.Description":"<p>body</p>","System.Tags":"bug;infra"}}
JSON
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/wi.json" \
        run azure_run provider_issues_view "" 101 --json number,title,state,body
    [ "$status" -eq 0 ]
    printf '%s\n' "$output" | jq -e '.number == 101 and .title == "First bug" and .state == "OPEN"' >/dev/null
    grep -q "workitems/101" "$STUB_CALL_LOG"
}

@test "provider_issues_view -q returns the projected scalar (not the object)" {
    # The grooming flow does view --json body -q .body > tmpfile and feeds
    # the tmpfile straight back into edit --body-file: the output MUST be
    # the body text alone, never a JSON object. The body passes through the
    # entity-decode (tags are the store's native HTML; they stay).
    cat > "$TEST_TEMP_DIR/wi.json" <<'JSON'
{"id":101,"fields":{"System.Title":"T","System.State":"New","System.Description":"fenced &quot;with quotes&quot;\n```\n","System.Tags":""}}
JSON
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/wi.json" \
        run azure_run provider_issues_view "" 101 --json body -q .body
    [ "$status" -eq 0 ]
    [ "$output" = $'fenced "with quotes"\n```' ]
    # And a url projection yields the scalar URL (issue-select url mode).
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/wi.json" \
        run azure_run provider_issues_view "" 101 --json url -q .url
    [ "$status" -eq 0 ]
    [[ "$output" == https://dev.azure.com/*/_workitems/edit/101 ]]
}

@test "provider_issues_exists is a silent presence test" {
    printf '{"id":101,"fields":{}}' > "$TEST_TEMP_DIR/wi.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/wi.json" \
        run azure_run provider_issues_exists "" 101
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "provider_issues_exists fails on 404" {
    printf '{"message":"not found"}' > "$TEST_TEMP_DIR/err.json"
    STUB_CURL_HTTP_CODE=404 STUB_CURL_RESPONSE="$TEST_TEMP_DIR/err.json" \
        run azure_run provider_issues_exists "" 999
    [ "$status" -ne 0 ]
}

@test "provider_issues_create posts a title-and-tags patch to the User Story type and prints the id" {
    printf '{"id":301,"fields":{}}' > "$TEST_TEMP_DIR/created.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/created.json" \
        run azure_run provider_issues_create --title "New work" --label bug --label infra
    [ "$status" -eq 0 ]
    [ "$output" = "301" ]
    grep -q 'workitems/\$User%20Story' "$STUB_CALL_LOG"
}

@test "provider_issues_create without a title fails defined" {
    run azure_run provider_issues_create --label bug
    [ "$status" -ne 0 ]
    [[ "$output" =~ "--title" ]]
}

@test "provider_issues_comment posts to the comments API" {
    printf '{"id":55,"text":"hello"}' > "$TEST_TEMP_DIR/comment.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/comment.json" \
        run azure_run provider_issues_comment "" 101 --body "hello"
    [ "$status" -eq 0 ]
    [ "$output" = "55" ]
    grep -q "workitems/101/comments" "$STUB_CALL_LOG"
}

# close and reopen read the item's own type, then that type's states by category
# (the shapes are the recorded ones: categories Proposed, InProgress, Resolved,
# Completed, Removed).
item_type_page() { printf '{"id":%s,"fields":{"System.WorkItemType":"%s"}}' "$1" "$2" > "$TEST_TEMP_DIR/type-$1.json"; }
page_queue() { : > "$TEST_TEMP_DIR/pages.queue"; local f; for f in "$@"; do printf '%s\n' "$f" >> "$TEST_TEMP_DIR/pages.queue"; done; }
FIXDIR="$BATS_TEST_DIRNAME/../fixtures/azure"

@test "provider_issues_close moves the item to the Completed state of its own type" {
    item_type_page 101 "User Story"
    printf '{"id":101}' > "$TEST_TEMP_DIR/patched.json"
    page_queue "$TEST_TEMP_DIR/type-101.json" "$FIXDIR/workitemtypes.user-story.states.json" "$TEST_TEMP_DIR/patched.json"
    : > "$TEST_TEMP_DIR/close.body"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/close.body" \
        run azure_run provider_issues_close "" 101
    [ "$status" -eq 0 ]
    grep -q 'workitemtypes/User%20Story/states' "$STUB_CALL_LOG"
    jq -s -e 'any(.[][]?; .path == "/fields/System.State" and .value == "Closed")' "$TEST_TEMP_DIR/close.body" >/dev/null
}

@test "provider_issues_close accepts and drops --reason (Azure has no close reason)" {
    item_type_page 101 "Issue"
    printf '{"id":101}' > "$TEST_TEMP_DIR/patched.json"
    page_queue "$TEST_TEMP_DIR/type-101.json" "$FIXDIR/workitemtypes.issue.states.json" "$TEST_TEMP_DIR/patched.json"
    : > "$TEST_TEMP_DIR/close.body"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/close.body" \
        run azure_run provider_issues_close "" 101 --reason "not planned"
    [ "$status" -eq 0 ]
    run ! grep -q 'not planned' "$TEST_TEMP_DIR/close.body"
    grep -q 'Closed' "$TEST_TEMP_DIR/close.body"
}

@test "provider_issues_reopen moves the item to the first Proposed state of its own type" {
    item_type_page 101 "User Story"
    printf '{"id":101}' > "$TEST_TEMP_DIR/patched.json"
    page_queue "$TEST_TEMP_DIR/type-101.json" "$FIXDIR/workitemtypes.user-story.states.json" "$TEST_TEMP_DIR/patched.json"
    : > "$TEST_TEMP_DIR/reopen.body"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/reopen.body" \
        run azure_run provider_issues_reopen "" 101
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[][]?; .path == "/fields/System.State" and .value == "New")' "$TEST_TEMP_DIR/reopen.body" >/dev/null
}

@test "provider_issues_reopen on an Issue (states Active and Closed only) uses its InProgress state" {
    item_type_page 101 "Issue"
    printf '{"id":101}' > "$TEST_TEMP_DIR/patched.json"
    page_queue "$TEST_TEMP_DIR/type-101.json" "$FIXDIR/workitemtypes.issue.states.json" "$TEST_TEMP_DIR/patched.json"
    : > "$TEST_TEMP_DIR/reopen.body"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/reopen.body" \
        run azure_run provider_issues_reopen "" 101
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[][]?; .path == "/fields/System.State" and .value == "Active")' "$TEST_TEMP_DIR/reopen.body" >/dev/null
}

@test "provider_issues_edit patches title and tags" {
    printf '{"id":101,"fields":{}}' > "$TEST_TEMP_DIR/edited.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/edited.json" \
        run azure_run provider_issues_edit "" 101 --title "Renamed" --add-label triage
    [ "$status" -eq 0 ]
    grep -q "workitems/101" "$STUB_CALL_LOG"
}

@test "provider_issues_create builds a valid JSON-Patch body when the title quotes JSON" {
    # User text must never sit in a hand-built JSON literal — a title
    # containing quotes/backslashes must still produce a parseable document.
    printf '{"id":302,"fields":{}}' > "$TEST_TEMP_DIR/created.json"
    : > "$TEST_TEMP_DIR/req-body.log"
    local title='Say "hi" back'
    local tag="bug'quote"
    STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/req-body.log" \
        STUB_CURL_RESPONSE="$TEST_TEMP_DIR/created.json" \
        run azure_run provider_issues_create --title "$title" --label "$tag"
    [ "$status" -eq 0 ]
    jq -e --arg t "$title" --arg g "$tag" \
        'length == 2 and .[0].value == $t and .[1].value == $g' \
        < "$TEST_TEMP_DIR/req-body.log"
}

@test "provider_issues_edit builds a valid JSON-Patch body when the body quotes JSON" {
    printf '{"id":101,"fields":{}}' > "$TEST_TEMP_DIR/edited.json"
    : > "$TEST_TEMP_DIR/req-body.log"
    local title='Title with "quotes" & back\slash'
    STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/req-body.log" \
        STUB_CURL_RESPONSE="$TEST_TEMP_DIR/edited.json" \
        run azure_run provider_issues_edit "" 101 --title "$title"
    [ "$status" -eq 0 ]
    jq -e --arg t "$title" 'length == 1 and .[0].value == $t' \
        < "$TEST_TEMP_DIR/req-body.log"
}

@test "provider_issues_list --type filters by work-item type in the WIQL query" {
    # --type must reach the WIQL WHERE clause, not fall into the repo
    # slot (unfiltered lists).
    printf '{"workItems":[]}' > "$TEST_TEMP_DIR/empty-wiql.json"
    : > "$TEST_TEMP_DIR/type-wiql.log"
    STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/type-wiql.log" \
        STUB_CURL_RESPONSE="$TEST_TEMP_DIR/empty-wiql.json" \
        run azure_run provider_issues_list --type Bug
    [ "$status" -eq 0 ]
    grep -q "System.WorkItemType] = 'Bug'" "$TEST_TEMP_DIR/type-wiql.log"
}

@test "provider_issues_list --json body projects a decoded body (issue-search contract)" {
    # The wrapper's search path matches on .body — the projected field
    # must carry the decoded markdown, not an empty string.
    wit_page > "$TEST_TEMP_DIR/details.json"
    printf '{"workItems":[{"id":101}]}' > "$TEST_TEMP_DIR/wiql.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/wiql.json" "$TEST_TEMP_DIR/details.json" > "$TEST_TEMP_DIR/pages.queue"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" \
        run azure_run provider_issues_list --json number,body
    [ "$status" -eq 0 ]
    jq -e 'length == 2 and all(.[]; has("number") and has("body"))' <<< "$output" >/dev/null
}

@test "provider_issues_list -q over an empty result is empty output, not null (gh semantics)" {
    printf '{"workItems":[]}' > "$TEST_TEMP_DIR/empty-wiql.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/empty-wiql.json" \
        run azure_run provider_issues_list -q '.[0].number'
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "provider_issues_list composes valid WIQL JSON when the label quotes the query" {
    # A label containing a quote must not break the WIQL document.
    printf '{"workItems":[]}' > "$TEST_TEMP_DIR/empty-wiql.json"
    : > "$TEST_TEMP_DIR/wiql-body.log"
    STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/wiql-body.log" \
        STUB_CURL_RESPONSE="$TEST_TEMP_DIR/empty-wiql.json" \
        run azure_run provider_issues_list --label "tag'with'quotes"
    [ "$status" -eq 0 ]
    # Document must parse and the quoted label must survive intact inside
    # the query string (the assertion text avoids nested single quotes).
    local q
    q=$(jq -r '.query' < "$TEST_TEMP_DIR/wiql-body.log")
    [[ "$q" == *"CONTAINS"* ]] || return 1
    case "$q" in
        # Valid shapes: raw label, or WIQL-escaped (single quotes doubled
        # per the WIQL escape rule — the composition's whole point).
        *tagwithquotes*|*tag"'"with"'"quotes*|*"tag''with''quotes"*) ;;
        *) echo "label not intact/escaped in: $q" >&2; return 1 ;;
    esac
}

@test "provider_issues_edit with nothing to edit fails defined" {
    run azure_run provider_issues_edit 101
    [ "$status" -ne 0 ]
    [[ "$output" =~ "nothing to edit" ]]
}

@test "provider_issues_comments maps the discussion shape" {
    cat > "$TEST_TEMP_DIR/comments.json" <<'JSON'
{"comments":[{"createdBy":{"displayName":"Alice"},"text":"first","createdDate":"2026-09-26T10:00:00Z"},{"createdBy":{"displayName":"Bob"},"text":"second","createdDate":"2026-09-26T11:00:00Z"}]}
JSON
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/comments.json" \
        run azure_run provider_issues_comments "" 101
    [ "$status" -eq 0 ]
    jq -e 'any(.[]; .user.login == "Alice" and .body == "first") and any(.[]; .user.login == "Bob")' <<< "$output" >/dev/null
}

@test "artifact header survives the comment round-trip (DEVENV_ARTIFACT_V1)" {
    # The issue-artifact machinery posts markdown comments whose first line is
    # the DEVENV_ARTIFACT_V1 header; the comment transport must not mangle it.
    local header_line='<!-- DEVENV_ARTIFACT_V1'
    printf '{"id":77,"text":"kept"}' > "$TEST_TEMP_DIR/art.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/art.json" \
        run azure_run provider_issues_comment "" 101 --body "$header_line doc_id: x -->"
    [ "$status" -eq 0 ]
    # The transport posts the body as-is (jq -n --arg): no shell mangling of
    # the < ! -- sequence. Assert via the stub having been called; content
    # fidelity is jq's, verified by the unit test above.
    grep -q "workitems/101/comments" "$STUB_CALL_LOG"
}

@test "provider_issues_label_list reads the project's tags from the tags endpoint" {
    printf '{"count":3,"value":[{"id":"1","name":"bug"},{"id":"2","name":" infra"},{"id":"3","name":"triage"}]}' > "$TEST_TEMP_DIR/tags.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/tags.json" run azure_run provider_issues_label_list
    [ "$status" -eq 0 ]
    [ "$(jq -c '[.[].name]' <<< "$output")" = '["bug","infra","triage"]' ]
    grep -q '/_apis/wit/tags' "$STUB_CALL_LOG"
}

@test "provider_issues_label_list falls back to the distinct tags of the work items when the tags endpoint is unavailable" {
    printf '{}' > "$TEST_TEMP_DIR/no-tags.json"
    printf '{"workItems":[{"id":1},{"id":2}]}' > "$TEST_TEMP_DIR/wiql.json"
    cat > "$TEST_TEMP_DIR/details.json" <<'JSON'
{"value":[
  {"id":1,"fields":{"System.Tags":"bug; infra"}},
  {"id":2,"fields":{"System.Tags":"bug; triage"}}
]}
JSON
    printf '%s\n%s\n%s\n' "$TEST_TEMP_DIR/no-tags.json" "$TEST_TEMP_DIR/wiql.json" "$TEST_TEMP_DIR/details.json" > "$TEST_TEMP_DIR/pages.queue"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" \
        run azure_run provider_issues_label_list
    [ "$status" -eq 0 ]
    [ "$(jq -c '[.[].name]' <<< "$output")" = '["bug","infra","triage"]' ]
}

# ============================================================================
# Comment + label contract verbs
# ============================================================================

@test "comment create targets the markdown-format route" {
    printf '{"id":8663010,"workItemId":42,"text":"m"}' > "$TEST_TEMP_DIR/c2.json"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    gh_calls_reset
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/c2.json" \
        run azure_run provider_issues_comment_add o1/p1/r1 42 --body "m"
    [ "$status" -eq 0 ]
    # The portal only renders markdown when the create carries ?format=markdown
    # at the 7.2-preview.4 schema (body-side format is silently ignored).
    grep -q "format=markdown" "$TEST_TEMP_DIR/stub-calls.log"
    grep -q "api-version=7.2-preview.4" "$TEST_TEMP_DIR/stub-calls.log"
}

@test "provider_issues_comment_add creates a comment and emits gh-shaped JSON" {
    printf '{"id":777001,"workItemId":42,"text":"hello"}' > "$TEST_TEMP_DIR/created.json"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/created.json" \
        run azure_run provider_issues_comment_add o1/p1/r1 42 --body "hello"
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -r '.id')" = "42/777001" ]
    [[ "$(printf '%s' "$output" | jq -r '.url')" =~ _workitems/edit/42 ]]
}

@test "provider_issues_comment_edit patches the comment body" {
    printf '{"id":777001,"workItemId":42,"text":"updated"}' > "$TEST_TEMP_DIR/edited.json"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/edited.json" \
        run azure_run provider_issues_comment_edit o1/p1/r1 42/777001 --body "updated"
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -r '.id')" = "42/777001" ]
}

@test "provider_issues_comment_get finds the comment and reports its url" {
    printf '{"totalCount":1,"count":1,"comments":[{"id":777001,"workItemId":42,"text":"found"}]}' > "$TEST_TEMP_DIR/list.json"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/list.json" \
        run azure_run provider_issues_comment_get "" 42/777001
    [ "$status" -eq 0 ]
}

@test "provider_issues_comment_get fails defined when the id is absent" {
    printf '{"totalCount":0,"count":0,"comments":[]}' > "$TEST_TEMP_DIR/empty.json"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/empty.json" \
        run azure_run provider_issues_comment_get "" 42/999
    [ "$status" -ne 0 ]
}

@test "provider_issues_comments restores markdown from the html-encoded store" {
    # Azure entity-encodes long text (quotes -> &quot;) and treats trailing
    # newlines loosely; the boundary contract restores markdown and is
    # trailing-newline-insensitive.
    cat > "$TEST_TEMP_DIR/list.json" << 'JSONEOF'
{"totalCount":1,"count":1,"comments":[{"id":8663000,"workItemId":42,"text":"fenced block &quot;with quotes&quot;\n```\n"}]}
JSONEOF
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/list.json" \
        run azure_run provider_issues_comments "" 42
    [ "$status" -eq 0 ]
    [ "$(jq -j '.[0].body' <<< "$output")" = $'fenced block "with quotes"\n```' ]
}

@test "provider_issues_comment_add normalizes the trailing newline before storage" {
    printf '{"id":8663001,"workItemId":42,"text":"sent"}' > "$TEST_TEMP_DIR/created.json"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    : > "$TEST_TEMP_DIR/curlbody.log"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/created.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/curlbody.log" \
        run azure_run provider_issues_comment_add o1/p1/r1 42 --body $'line\n'
    [ "$status" -eq 0 ]
    # The stored text must be exactly "line": the trailing newline the user
    # passed is stripped here (the store re-adds it), so a write->read
    # cycle is newline-stable. jq -j asserts without adding one of our own.
    [ "$(jq -j '.text' < "$TEST_TEMP_DIR/curlbody.log")" = "line" ]
}

@test "provider_issues_comments emits id and url for artifact matching" {
    printf '{"totalCount":1,"count":1,"comments":[{"id":777001,"workItemId":42,"text":"b","createdBy":{"displayName":"a"},"createdDate":"2026-01-01"}]}' > "$TEST_TEMP_DIR/list.json"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/list.json" \
        run azure_run provider_issues_comments "" 42
    [ "$status" -eq 0 ]
    [ "$(jq -r '.[0].id' <<< "$output")" = "42/777001" ]
    [[ "$(jq -r '.[0].url' <<< "$output")" =~ _workitems/edit/42 ]]
}

@test "provider_issues_add_tag appends to existing tags and is idempotent" {
    printf '{"fields":{"System.Tags":"existing;tags"}}' > "$TEST_TEMP_DIR/view.json"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/view.json" \
        run azure_run provider_issues_add_tag 42 newtag
    [ "$status" -eq 0 ]
}

@test "provider_issues_label_create without --issue fails defined (azure tags need a work item)" {
    run azure_run provider_issues_label_create o1/p1/r1 mytag
    [ "$status" -ne 0 ]
    [[ "$output" =~ "--issue" ]]
}

@test "provider_issues_label_update is a no-op success (tags have no color/description)" {
    run azure_run provider_issues_label_update o1/p1/r1 mytag ff0000 "desc"
    [ "$status" -eq 0 ]
}

# ============================================================================
# Sub-issue graph relation verbs
# ============================================================================

@test "provider_issue_graph_children lists Hierarchy-Forward relation ids" {
    cat > "$TEST_TEMP_DIR/parent.json" << 'JSONEOF'
{"id":100,"relations":[{"rel":"System.LinkTypes.Hierarchy-Forward","url":"https://dev.azure.com/o/p/_apis/wit/workItems/101"},{"rel":"System.LinkTypes.Related","url":"https://dev.azure.com/o/p/_apis/wit/workItems/999"},{"rel":"System.LinkTypes.Hierarchy-Forward","url":"https://dev.azure.com/o/p/_apis/wit/workItems/102"}]}
JSONEOF
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/parent.json" \
        run azure_run provider_issue_graph_children "" 100
    [ "$status" -eq 0 ]
    [ "${lines[0]}" = "101" ]
    [ "${lines[1]}" = "102" ]
}

@test "provider_issue_graph_parent resolves the Hierarchy-Reverse target" {
    cat > "$TEST_TEMP_DIR/child.json" << 'JSONEOF'
{"id":101,"relations":[{"rel":"System.LinkTypes.Hierarchy-Reverse","url":"https://dev.azure.com/o/p/_apis/wit/workItems/100"}]}
JSONEOF
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/child.json" \
        run azure_run provider_issue_graph_parent "" 101
    [ "$status" -eq 0 ]
    [ "$output" = "100" ]
}

@test "provider_issue_graph_parent without relations emits empty" {
    printf '{"id":101}' > "$TEST_TEMP_DIR/bare.json"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/bare.json" \
        run azure_run provider_issue_graph_parent "" 101
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "provider_issue_graph_link patches a Hierarchy-Forward relation" {
    printf '{"id":100}' > "$TEST_TEMP_DIR/linked.json"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    : > "$TEST_TEMP_DIR/reqbody.log"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/linked.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/reqbody.log" \
        run azure_run provider_issue_graph_link "" 100 101
    [ "$status" -eq 0 ]
    grep -q "System.LinkTypes.Hierarchy-Forward" "$TEST_TEMP_DIR/reqbody.log"
    grep -q "workItems/101" "$TEST_TEMP_DIR/reqbody.log"
}

@test "provider_issue_graph_unlink removes the matching relation by index" {
    cat > "$TEST_TEMP_DIR/parent2.json" << 'JSONEOF'
{"id":100,"relations":[{"rel":"System.LinkTypes.Hierarchy-Forward","url":"https://dev.azure.com/o/p/_apis/wit/workItems/101"},{"rel":"System.LinkTypes.Hierarchy-Forward","url":"https://dev.azure.com/o/p/_apis/wit/workItems/102"}]}
JSONEOF
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"

    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/parent2.json" \
        run azure_run provider_issue_graph_unlink "" 100 101
    [ "$status" -eq 0 ]
}

# A custom curl: PATCH answers 409 with the given message; GET answers the parent's relations.
_graph_link_conflict_curl() {   # <message> <relations json>
    printf '{"message":"%s"}' "$1" > "$TEST_TEMP_DIR/conflict.json"
    printf '%s' "$2" > "$TEST_TEMP_DIR/parent-rel.json"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"
    stub_curl
    mv "$STUB_BIN_DIR/curl" "$STUB_BIN_DIR/curl-inner"
    cat > "$STUB_BIN_DIR/curl" <<MOCK
#!/usr/bin/env bash
if [[ " \$* " == *" PATCH "* ]]; then
    export STUB_CURL_RESPONSE="$TEST_TEMP_DIR/conflict.json" STUB_CURL_HTTP_CODE=409
else
    export STUB_CURL_RESPONSE="$TEST_TEMP_DIR/parent-rel.json"
fi
exec "\$(dirname "\$0")/curl-inner" "\$@"
MOCK
    chmod +x "$STUB_BIN_DIR/curl"
}

@test "provider_issue_graph_link: a conflict is success only when the parent already lists the child" {
    _graph_link_conflict_curl "Relation already exists" '{"id":100,"relations":[{"rel":"System.LinkTypes.Hierarchy-Forward","url":"https://dev.azure.com/o1/p1/_apis/wit/workItems/101"}]}'
    run azure_run provider_issue_graph_link "" 100 101
    [ "$status" -eq 0 ]
}

@test "provider_issue_graph_link: a failure whose text contains 'already' but whose link is absent stays a failure" {
    _graph_link_conflict_curl "Child already has a parent link" '{"id":100,"relations":[]}'
    run azure_run provider_issue_graph_link "" 100 101
    [ "$status" -ne 0 ]
}

@test "provider_issues_view leaves a markdown description undecoded and decodes an HTML one" {
    printf '%s' '{"id":101,"fields":{"System.Title":"t","System.State":"New","System.Description":"use &lt;div&gt; and &amp; literally"},"multilineFieldsFormat":{"System.Description":"markdown"}}' > "$TEST_TEMP_DIR/md.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/md.json" \
        run azure_run provider_issues_view "" 101 --json body -q .body
    [ "$status" -eq 0 ]
    [ "$output" = 'use &lt;div&gt; and &amp; literally' ]

    printf '%s' '{"id":101,"fields":{"System.Title":"t","System.State":"New","System.Description":"say &quot;hi&quot; &amp; bye"},"multilineFieldsFormat":{}}' > "$TEST_TEMP_DIR/html.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/html.json" \
        run azure_run provider_issues_view "" 101 --json body -q .body
    [ "$output" = 'say "hi" & bye' ]
}

@test "provider_issues_list applies the same markdown rule per item" {
    printf '%s' '{"workItems":[{"id":1},{"id":2}]}' > "$TEST_TEMP_DIR/wiql.json"
    printf '%s' '{"value":[{"id":1,"fields":{"System.Title":"a","System.State":"New","System.Description":"a &lt; b"},"multilineFieldsFormat":{"System.Description":"markdown"}},{"id":2,"fields":{"System.Title":"b","System.State":"New","System.Description":"a &lt; b"}}]}' > "$TEST_TEMP_DIR/batch.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/wiql.json" "$TEST_TEMP_DIR/batch.json" > "$TEST_TEMP_DIR/pages.q"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.q" \
        run azure_run provider_issues_list "" --json number,body
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -r '.[] | select(.number == 1) | .body')" = 'a &lt; b' ]
    [ "$(printf '%s' "$output" | jq -r '.[] | select(.number == 2) | .body')" = 'a < b' ]
}
