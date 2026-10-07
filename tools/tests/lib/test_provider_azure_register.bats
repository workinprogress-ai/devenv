#!/usr/bin/env bats
# Outcome tests for the Azure provider, written against responses RECORDED from a
# live Azure DevOps org (tools/tests/fixtures/azure/, captured by
# azure-smoke-test.sh with AZURE_SMOKE_CAPTURE_DIR). Each asserts what the verb does
# with a real response shape, so a verb that drifts from the recorded behavior fails
# here before it reaches a live org.
#
# Not every behavior has a live recording (no pipeline definitions, no relations or
# comment pages were recorded); those tests build the response from the documented API
# shape and say so in a comment.

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
    # The transport sleeps between retries; the tests do not wait for it.
    printf '#!/usr/bin/env bash\nexit 0\n' > "$STUB_BIN_DIR/sleep"
    chmod +x "$STUB_BIN_DIR/sleep"
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
    source "$DEVENV_TOOLS/lib/providers/azure/auth.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/issues.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/prs.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/pipelines.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/projects.bash"
}
azure_run() {
    azure_libs_source
    "$@"
}

# A recorded work item is a single JSON object, which is also what the PATCH and GET
# calls of one verb all receive from the single-response stub.

# ---------------------------------------------------------------------------
# Pull requests
# ---------------------------------------------------------------------------

@test "provider_prs_merge --rebase --delete-branch sends completionOptions with the strategy and branch deletion" {
    STUB_CURL_RESPONSE="$FIXTURES/pullrequest.completed.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_prs_merge repo1 12 --rebase --delete-branch
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[]; .completionOptions.mergeStrategy == "rebase" and .completionOptions.deleteSourceBranch == true)' "$REQ_BODIES" >/dev/null
}

@test "provider_prs_list --state merged queries completed PRs (verified live)" {
    STUB_CURL_RESPONSE="$FIXTURES/pullrequests.list.all.json" \
        run azure_run provider_prs_list repo1 --state merged
    [ "$status" -eq 0 ]
    grep -q "status=completed" "$STUB_CALL_LOG"
}

@test "provider_prs_list --state closed also covers abandoned PRs" {
    STUB_CURL_RESPONSE="$FIXTURES/pullrequests.list.all.json" \
        run azure_run provider_prs_list repo1 --state closed
    [ "$status" -eq 0 ]
    grep -qE "status=(all|abandoned)" "$STUB_CALL_LOG"
}

@test "provider_prs_threads_page maps the recorded comment text and author" {
    STUB_CURL_RESPONSE="$FIXTURES/pullrequest.threads.json" \
        run azure_run provider_prs_threads_page org/proj/repo1 12
    [ "$status" -eq 0 ]
    expected="$(jq -r '.value[0].comments[0].content' "$FIXTURES/pullrequest.threads.json")"
    jq -e --arg c "$expected" '.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0].body == $c' <<< "$output" >/dev/null
}

@test "provider_prs_threads_page emits each thread under its real id, <pr>/<thread>" {
    STUB_CURL_RESPONSE="$FIXTURES/pullrequest.threads.json" \
        run azure_run provider_prs_threads_page org/proj/repo1 12
    [ "$status" -eq 0 ]
    tid="$(jq '.value[0].id' "$FIXTURES/pullrequest.threads.json")"
    jq -e --arg id "12/$tid" '.data.repository.pullRequest.reviewThreads.nodes[0].id == $id' <<< "$output" >/dev/null
}

@test "provider_prs_threads_page reports an active thread unresolved and a fixed thread resolved" {
    jq '{value: [.]}' "$FIXTURES/pullrequest.thread.resolved.json" > "$TEST_TEMP_DIR/resolved-list.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resolved-list.json" \
        run azure_run provider_prs_threads_page org/proj/repo1 12
    [ "$status" -eq 0 ]
    jq -e '.data.repository.pullRequest.reviewThreads.nodes[0].isResolved == true' <<< "$output" >/dev/null
    STUB_CURL_RESPONSE="$FIXTURES/pullrequest.threads.json" \
        run azure_run provider_prs_threads_page org/proj/repo1 12
    jq -e '.data.repository.pullRequest.reviewThreads.nodes[0].isResolved == false' <<< "$output" >/dev/null
}

@test "provider_prs_thread_resolve accepts the recorded response, whose status is a string" {
    tid="$(jq '.id' "$FIXTURES/pullrequest.thread.resolved.json")"
    STUB_CURL_RESPONSE="$FIXTURES/pullrequest.thread.resolved.json" \
        run azure_run provider_prs_thread_resolve "o1/p1/r1" "12/$tid"
    [ "$status" -eq 0 ]
    [[ "$output" != *"unknown"* ]]
}

# ---------------------------------------------------------------------------
# Work items: tags
# ---------------------------------------------------------------------------

@test "provider_issues_view trims the space Azure puts after each tag separator" {
    # recorded System.Tags is "smoke-tag; smoke-tag-2"
    STUB_CURL_RESPONSE="$FIXTURES/workitem.tags.two.json" \
        run azure_run provider_issues_view "" 101
    [ "$status" -eq 0 ]
    jq -e '[.labels[].name] == ["smoke-tag","smoke-tag-2"]' <<< "$output" >/dev/null
}

@test "provider_issues_add_tag is a no-op for a tag already present in the recorded tag string" {
    STUB_CURL_RESPONSE="$FIXTURES/workitem.tags.two.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_issues_add_tag 101 smoke-tag-2
    [ "$status" -eq 0 ]
    [ ! -s "$REQ_BODIES" ]
}

@test "provider_issues_edit --remove-label removes only that tag" {
    STUB_CURL_RESPONSE="$FIXTURES/workitem.tags.two.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_issues_edit "" 101 --remove-label smoke-tag-2
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[][]?; .path == "/fields/System.Tags" and .value == "smoke-tag")' "$REQ_BODIES" >/dev/null
}

@test "provider_issues_edit --add-label sends an add op on System.Tags, which Azure appends to the existing tags (verified live)" {
    STUB_CURL_RESPONSE="$FIXTURES/workitem.tags.two.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_issues_edit "" 101 --add-label extra-tag
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[][]?; .op == "add" and .path == "/fields/System.Tags" and (.value | contains("extra-tag")))' "$REQ_BODIES" >/dev/null
}

# ---------------------------------------------------------------------------
# Work items: batching, comments, relations (built from the documented API shape;
# there is no live recording of these)
# ---------------------------------------------------------------------------

@test "provider_issues_list sends at most 200 ids per workitemsbatch request" {
    # 450 ids from the WIQL step; the batch endpoint accepts at most 200 per call
    jq -n '{workItems: [range(1; 451) | {id: .}], value: []}' > "$TEST_TEMP_DIR/wiql450.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/wiql450.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_issues_list --state all --limit 1000
    jq -s -e 'all(.[]; ((.ids // []) | length) <= 200)' "$REQ_BODIES" >/dev/null
}

@test "provider_issue_graph_unlink removes the child by its index in the full relations array" {
    # a commit ArtifactLink at index 0, the child at index 1: the index must be 1
    cat > "$TEST_TEMP_DIR/parent-rels.json" <<'JSON'
{"id":100,"relations":[
 {"rel":"ArtifactLink","url":"vstfs:///Git/Commit/aaaa%2Fbbbb%2Fcccc"},
 {"rel":"System.LinkTypes.Hierarchy-Forward","url":"https://dev.azure.com/o/p/_apis/wit/workItems/101"}]}
JSON
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/parent-rels.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_issue_graph_unlink "" 100 101
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[][]?; .op == "remove" and .path == "/relations/1")' "$REQ_BODIES" >/dev/null
}

# ---------------------------------------------------------------------------
# Status: the board Kanban column is the status (verified live on a User Story)
# ---------------------------------------------------------------------------

@test "provider_projects_for_issue reads the status from the Kanban column, not System.State" {
    # recorded: System.State "Active", Kanban column "Review"
    STUB_CURL_RESPONSE="$FIXTURES/kanban.column.Review.json" \
        run azure_run provider_projects_for_issue "https://dev.azure.com/org/proj/_workitems/edit/101" ""
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | cut -f3)" = "Review" ]
}

@test "provider_projects_field_option_ids accepts every status_workflow word" {
    for word in TBD To-Groom Ready Implementing Review Merged Staging Production; do
        STUB_CURL_RESPONSE="$FIXTURES/workitemtypes.user-story.states.json" \
            run azure_run provider_projects_field_option_ids proj Status "$word"
        [ "$status" -eq 0 ] || { echo "word '$word' rejected: $output"; false; }
    done
}

@test "provider_projects_field_set writes the item's Kanban column field" {
    STUB_CURL_RESPONSE="$FIXTURES/kanban.column.Review.json" STUB_CURL_REQUEST_BODY="$REQ_BODIES" \
        run azure_run provider_projects_field_set proj 101 Status Review
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[][]?; (.path | test("^/fields/WEF_.*_Kanban\\.Column$")) and .value == "Review")' "$REQ_BODIES" >/dev/null
}

# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------

@test "azure-http: a 203 sign-in page is a typed auth error that names key-update-azure" {
    printf '<html><body>Sign in to your account</body></html>' > "$TEST_TEMP_DIR/signin.html"
    STUB_CURL_HTTP_CODE=203 STUB_CURL_RESPONSE="$TEST_TEMP_DIR/signin.html" \
        run azure_run azure_http_request GET "https://dev.azure.com/org/_apis/projects"
    [ "$status" -ne 0 ]
    [[ "$output" == *"key-update-azure"* ]]
}

@test "azure-http: a 401 names key-update-azure" {
    printf '{"message":"unauthorized"}' > "$TEST_TEMP_DIR/401.json"
    STUB_CURL_HTTP_CODE=401 STUB_CURL_RESPONSE="$TEST_TEMP_DIR/401.json" \
        run azure_run azure_http_request GET "https://dev.azure.com/org/_apis/projects"
    [ "$status" -ne 0 ]
    [[ "$output" == *"key-update-azure"* ]]
}

@test "azure-http: a failing POST is not retried, a failing GET is" {
    printf '{"message":"unavailable"}' > "$TEST_TEMP_DIR/503.json"
    : > "$STUB_CALL_LOG"
    STUB_CURL_HTTP_CODE=503 STUB_CURL_RESPONSE="$TEST_TEMP_DIR/503.json" \
        run azure_run azure_http_request POST "https://dev.azure.com/org/proj/_apis/wit/workitems/\$Issue" '{"a":1}'
    post_calls="$(grep -c "^curl " "$STUB_CALL_LOG")"
    : > "$STUB_CALL_LOG"
    STUB_CURL_HTTP_CODE=503 STUB_CURL_RESPONSE="$TEST_TEMP_DIR/503.json" \
        run azure_run azure_http_request GET "https://dev.azure.com/org/_apis/projects"
    get_calls="$(grep -c "^curl " "$STUB_CALL_LOG")"
    [ "$post_calls" -eq 1 ]
    [ "$get_calls" -ge 2 ]
}

@test "azure-http: the Authorization header does not ride curl's argv" {
    cat > "$STUB_BIN_DIR/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$TEST_TEMP_DIR/curl-argv.log"
prev=""
for arg in "$@"; do
    if [[ "$prev" == "-D" ]]; then printf 'HTTP/1.1 200 OK\r\n\r\n' > "$arg"; fi
    prev="$arg"
done
printf '{"value":[]}'
EOF
    chmod +x "$STUB_BIN_DIR/curl"
    run azure_run azure_http_request GET "https://dev.azure.com/org/_apis/projects"
    [ "$status" -eq 0 ]
    ! grep -qi "^Authorization:" "$TEST_TEMP_DIR/curl-argv.log"
}

# ---------------------------------------------------------------------------
# Pipelines (built from the documented API shape; the test project has no definitions)
# ---------------------------------------------------------------------------

@test "provider_pipelines_run_list --repo sends the repository GUID, not the name" {
    printf '{"id":"guid-1234","name":"r1"}' > "$TEST_TEMP_DIR/repo.json"
    printf '{"value":[]}' > "$TEST_TEMP_DIR/builds.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/repo.json" "$TEST_TEMP_DIR/builds.json" > "$TEST_TEMP_DIR/queue"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/queue" \
        run azure_run provider_pipelines_run_list "o1/p1/r1"
    [ "$status" -eq 0 ]
    grep -q "repositoryId=guid-1234" "$STUB_CALL_LOG"
}

@test "provider_pipelines_run_list --workflow NAME does not send the name as a definitions id" {
    printf '{"value":[]}' > "$TEST_TEMP_DIR/empty.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/empty.json" \
        run azure_run provider_pipelines_run_list --workflow ci.yml
    ! grep -q "definitions=ci.yml" "$STUB_CALL_LOG"
}

@test "provider_pipelines_run_rerun retries the build with ?retry=true" {
    printf '{"id":9001}' > "$TEST_TEMP_DIR/rerun.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/rerun.json" \
        run azure_run provider_pipelines_run_rerun "" 9001
    [ "$status" -eq 0 ]
    grep -q "retry=true" "$STUB_CALL_LOG"
}

# ---------------------------------------------------------------------------
# Recorded after the team managed Bugs as requirements, and after a nested reply
# ---------------------------------------------------------------------------

@test "provider_projects_for_issue reads a Bug's status from its Kanban column, on the Stories board" {
    STUB_CURL_RESPONSE="$FIXTURES/workitem.bug.json" \
        run azure_run provider_projects_for_issue "https://dev.azure.com/org/proj/_workitems/edit/101" ""
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | cut -f1)" = "Stories" ]
    [ "$(printf '%s' "$output" | cut -f3)" = "TBD" ]
}

@test "provider_prs_threads_page lists the recorded reply under its thread, addressed <thread>/<comment>" {
    jq '{value: [.]}' "$FIXTURES/pullrequest.thread.after-reply.json" > "$TEST_TEMP_DIR/after-reply.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/after-reply.json" \
        run azure_run provider_prs_threads_page org/proj/repo1 12
    [ "$status" -eq 0 ]
    tid="$(jq '.id' "$FIXTURES/pullrequest.thread.after-reply.json")"
    [ "$(jq -c '[.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[].id]' <<< "$output")" = "[\"$tid/1\",\"$tid/2\"]" ]
}
