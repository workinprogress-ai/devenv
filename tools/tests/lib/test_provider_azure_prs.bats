#!/usr/bin/env bats
# Tests for the azure provider PR domain: list/view field mapping, create
# (draft + reviewers), the rebase-merge two-step with deleteSourceBranch,
# diff, comment, and the review-thread verbs. All transport via stub_curl.

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

azure_libs_source() {
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    PROVIDER_NAME=azure
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/urls.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/repos.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/issues.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/prs.bash"
}
azure_run() {
    azure_libs_source
    "$@"
}

pr_payload() {
    cat <<'JSON'
{"pullRequestId":12,"title":"Add feature","description":"body text","status":"active","isDraft":true,"mergeStatus":"succeeded",
 "sourceRefName":"refs/heads/feature/x","targetRefName":"refs/heads/master",
 "createdBy":{"displayName":"Alice"},
 "lastMergeSourceCommit":{"commitId":"abc123def456"},
 "repository":{"webUrl":"https://dev.azure.com/org/proj/_git/repo1"}}
JSON
}

@test "provider_prs_list maps fields and filters into Azure criteria" {
    printf '{"value":[{"pullRequestId":12,"title":"t","status":"active","isDraft":false,"sourceRefName":"refs/heads/f","targetRefName":"refs/heads/m","repository":{"webUrl":"https://dev.azure.com/org/proj/_git/r"}}]}' > "$TEST_TEMP_DIR/prs.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/prs.json" \
        run azure_run provider_prs_list proj/repo1 --state open --head f --base m
    [ "$status" -eq 0 ]
    printf '%s\n' "$output" | jq -e '.[0].number == 12 and .[0].state == "OPEN" and .[0].headRefName == "f" and .[0].baseRefName == "m"' >/dev/null
    grep -q "status=active" "$STUB_CALL_LOG"
    grep -q "sourceRefName=refs%2Fheads%2Ff" "$STUB_CALL_LOG"
    grep -q "targetRefName=refs%2Fheads%2Fm" "$STUB_CALL_LOG"
}

@test "provider_prs_list --json/--jq apply gh list semantics (scalar select over the array)" {
    # pr-create relies on --jq '.[0].url' returning
    # a scalar (empty for no match, the url string for a match).
    printf '{"value":[{"pullRequestId":12,"title":"t","status":"active","isDraft":false,"sourceRefName":"refs/heads/f","targetRefName":"refs/heads/m","repository":{"webUrl":"https://dev.azure.com/org/proj/_git/r"}}]}' > "$TEST_TEMP_DIR/prs.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/prs.json" \
        run azure_run provider_prs_list "" --state open --json url --jq '.[0].url'
    [ "$status" -eq 0 ]
    [ "$output" = "https://dev.azure.com/org/proj/_git/r/pullrequest/12" ]
}

@test "provider_prs_list --jq over an empty result is empty output, not the string null" {
    # gh suppresses null jq results; consumers gate on [ -n "$url" ] to
    # decide whether an open PR exists — "null" would short-circuit creation.
    printf '{"value":[]}' > "$TEST_TEMP_DIR/none.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/none.json" \
        run azure_run provider_prs_list "" --state open --json url --jq '.[0].url'
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "provider_prs_list --state closed returns completed and abandoned PRs but not active ones" {
    printf '{"value":[{"pullRequestId":1,"status":"active","sourceRefName":"refs/heads/a","targetRefName":"refs/heads/m"},{"pullRequestId":2,"status":"abandoned","sourceRefName":"refs/heads/b","targetRefName":"refs/heads/m"},{"pullRequestId":3,"status":"completed","sourceRefName":"refs/heads/c","targetRefName":"refs/heads/m"}]}' > "$TEST_TEMP_DIR/all.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/all.json" run azure_run provider_prs_list proj/repo1 --state closed
    [ "$status" -eq 0 ]
    [ "$(jq -c '[.[].number]' <<< "$output")" = "[2,3]" ]
}

@test "provider_prs_list pages with \$skip until a short page, so a long list is not cut at the server default" {
    export AZURE_PR_PAGE_SIZE=2
    local mk='{"pullRequestId":%s,"status":"active","sourceRefName":"refs/heads/a","targetRefName":"refs/heads/m"}'
    printf '{"value":[%s,%s]}' "$(printf "$mk" 1)" "$(printf "$mk" 2)" > "$TEST_TEMP_DIR/p1.json"
    printf '{"value":[%s]}' "$(printf "$mk" 3)" > "$TEST_TEMP_DIR/p2.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/p1.json" "$TEST_TEMP_DIR/p2.json" > "$TEST_TEMP_DIR/pages.queue"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" run azure_run provider_prs_list proj/repo1 --state open
    [ "$status" -eq 0 ]
    [ "$(jq -c '[.[].number]' <<< "$output")" = "[1,2,3]" ]
    grep -q 'skip=0' "$STUB_CALL_LOG"
    grep -q 'skip=2' "$STUB_CALL_LOG"
}

@test "provider_prs_list --limit caps the result and asks for no more than the limit" {
    export AZURE_PR_PAGE_SIZE=2
    local mk='{"pullRequestId":%s,"status":"active","sourceRefName":"refs/heads/a","targetRefName":"refs/heads/m"}'
    printf '{"value":[%s,%s]}' "$(printf "$mk" 1)" "$(printf "$mk" 2)" > "$TEST_TEMP_DIR/p1.json"
    printf '{"value":[%s]}' "$(printf "$mk" 3)" > "$TEST_TEMP_DIR/p2.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/p1.json" "$TEST_TEMP_DIR/p2.json" > "$TEST_TEMP_DIR/pages.queue"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" run azure_run provider_prs_list proj/repo1 --state open --limit 3
    [ "$status" -eq 0 ]
    [ "$(jq 'length' <<< "$output")" -eq 3 ]
    grep -q 'top=1&' "$STUB_CALL_LOG"
}

@test "provider_prs_list with an unknown state fails instead of listing everything" {
    run azure_run provider_prs_list proj/repo1 --state bogus
    [ "$status" -ne 0 ]
    [[ "$output" == *"unknown state"* ]]
}

@test "provider_prs_list surfaces a transport failure" {
    STUB_CURL_FAIL=1 run azure_run provider_prs_list proj/repo1 --state open
    [ "$status" -ne 0 ]
}

@test "provider_prs_view maps the gh-dialect field set callers consume" {
    pr_payload > "$TEST_TEMP_DIR/pr.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/pr.json" \
        run azure_run provider_prs_view "" 12 --json title,body,isDraft,state,author --jq .
    [ "$status" -eq 0 ]
    printf '%s\n' "$output" | jq -e '.title == "Add feature" and .body == "body text" and .isDraft == true and .state == "OPEN" and .author.login == "Alice"' >/dev/null
}

@test "provider_prs_view -q headRefOid returns the source commit" {
    pr_payload > "$TEST_TEMP_DIR/pr.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/pr.json" \
        run azure_run provider_prs_view "" 12 --json headRefOid -q .headRefOid
    [ "$status" -eq 0 ]
    [ "$output" = "abc123def456" ]
}

@test "provider_prs_create posts refs/heads-qualified refs and prints the web URL" {
    printf '{"pullRequestId":15,"repository":{"webUrl":"https://dev.azure.com/org/proj/_git/repo1"}}' > "$TEST_TEMP_DIR/created.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/created.json" \
        run azure_run provider_prs_create repo1 --title "New PR" --body "desc" --head feature/y --base master --draft
    [ "$status" -eq 0 ]
    [ "$output" = "https://dev.azure.com/org/proj/_git/repo1/pullrequest/15" ]
    # The POST body carried refs/heads-qualified branch names (jq via the
    # request payload is not logged; assert the endpoint was hit).
    grep -q "repositories/repo1/pullrequests?api-version" "$STUB_CALL_LOG"
}

# --reviewer takes a person (email, account or display name), which Azure only
# accepts as an identity id: a GUID is used as is, anything else is looked up.
create_pages() {   # create_pages <file>...  (queue of stubbed responses)
    : > "$TEST_TEMP_DIR/pages.queue"
    local f
    for f in "$@"; do printf '%s\n' "$f" >> "$TEST_TEMP_DIR/pages.queue"; done
}

@test "provider_prs_create looks a named reviewer up as an identity and adds that id" {
    printf '{"pullRequestId":15,"repository":{"webUrl":"https://dev.azure.com/org/proj/_git/repo1"}}' > "$TEST_TEMP_DIR/created.json"
    printf '{"count":1,"value":[{"id":"11111111-2222-4333-8444-555555555555","providerDisplayName":"Ann"}]}' > "$TEST_TEMP_DIR/identity.json"
    printf '[]' > "$TEST_TEMP_DIR/added.json"
    create_pages "$TEST_TEMP_DIR/created.json" "$TEST_TEMP_DIR/identity.json" "$TEST_TEMP_DIR/added.json"
    : > "$TEST_TEMP_DIR/create.body"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/create.body" \
        run azure_run provider_prs_create repo1 --title T --body B --head f --base m --reviewer ann@example.test
    [ "$status" -eq 0 ]
    grep -q "vssps.dev.azure.com/org/_apis/identities" "$STUB_CALL_LOG"
    grep -q "filterValue=ann%40example.test" "$STUB_CALL_LOG"
    jq -s -e 'any(.[]; type == "array" and .[0].id == "11111111-2222-4333-8444-555555555555")' "$TEST_TEMP_DIR/create.body" >/dev/null
}

@test "provider_prs_create uses a GUID reviewer as is, without a lookup" {
    printf '{"pullRequestId":15,"repository":{"webUrl":"https://dev.azure.com/org/proj/_git/repo1"}}' > "$TEST_TEMP_DIR/created.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/created.json" \
        run azure_run provider_prs_create repo1 --title T --body B --head f --base m --reviewer 11111111-2222-4333-8444-555555555555
    [ "$status" -eq 0 ]
    ! grep -q "identities" "$STUB_CALL_LOG"
}

@test "provider_prs_create still creates the PR when a reviewer cannot be found, and says so" {
    printf '{"pullRequestId":15,"repository":{"webUrl":"https://dev.azure.com/org/proj/_git/repo1"}}' > "$TEST_TEMP_DIR/created.json"
    printf '{"count":0,"value":[]}' > "$TEST_TEMP_DIR/noone.json"
    create_pages "$TEST_TEMP_DIR/created.json" "$TEST_TEMP_DIR/noone.json"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" \
        run azure_run provider_prs_create repo1 --title T --body B --head f --base m --reviewer nobody
    [ "$status" -eq 0 ]
    [[ "$output" == *"https://dev.azure.com/org/proj/_git/repo1/pullrequest/15"* ]]
    [[ "$output" == *"reviewer 'nobody'"* ]]
}

@test "provider_prs_create sends --label values as PR labels" {
    printf '{"pullRequestId":15,"repository":{"webUrl":"https://dev.azure.com/org/proj/_git/repo1"}}' > "$TEST_TEMP_DIR/created.json"
    : > "$TEST_TEMP_DIR/create.body"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/created.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/create.body" \
        run azure_run provider_prs_create repo1 --title T --body B --head f --base m --label bug --label review
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[]; (.labels // []) | map(.name) == ["bug","review"])' "$TEST_TEMP_DIR/create.body" >/dev/null
}

@test "provider_prs_create keeps a description over Azure's 4000-character limit whole, as a PR comment" {
    local long; long="$(head -c 4500 /dev/zero | tr '\0' 'x')"
    printf '{"pullRequestId":15,"repository":{"webUrl":"https://dev.azure.com/org/proj/_git/repo1"}}' > "$TEST_TEMP_DIR/created.json"
    printf '{"id":9}' > "$TEST_TEMP_DIR/thread.json"
    create_pages "$TEST_TEMP_DIR/created.json" "$TEST_TEMP_DIR/thread.json"
    : > "$TEST_TEMP_DIR/create.body"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/create.body" \
        run azure_run provider_prs_create repo1 --title T --body "$long" --head f --base m
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[]; has("description") and (.description | length) <= 4000)' "$TEST_TEMP_DIR/create.body" >/dev/null
    jq -s -e --arg l "$long" 'any(.[]; (.comments // [])[0].content == $l)' "$TEST_TEMP_DIR/create.body" >/dev/null
}

@test "provider_prs_view and list project the PR's own labels" {
    printf '{"pullRequestId":12,"title":"t","status":"active","sourceRefName":"refs/heads/f","targetRefName":"refs/heads/m","labels":[{"id":"1","name":"bug","active":true},{"id":"2","name":"old","active":false}],"reviewers":[{"displayName":"Rev"}],"repository":{"webUrl":"https://dev.azure.com/org/proj/_git/r"}}' > "$TEST_TEMP_DIR/labelled.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/labelled.json" run azure_run provider_prs_view repo1 12
    [ "$status" -eq 0 ]
    [ "$(jq -c '[.labels[].name]' <<< "$output")" = '["bug"]' ]
    printf '{"value":[%s]}' "$(cat "$TEST_TEMP_DIR/labelled.json")" > "$TEST_TEMP_DIR/labelled-list.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/labelled-list.json" run azure_run provider_prs_list repo1 --state open
    [ "$(jq -c '[.[0].labels[].name]' <<< "$output")" = '["bug"]' ]
}

@test "provider_prs_diff without --name-only emits one {path, changeType} object per changed file" {
    printf '{"value":[{"id":3}]}' > "$TEST_TEMP_DIR/iters.json"
    printf '{"changes":[{"changeType":"edit","item":{"path":"/src/a.cs"}},{"changeType":"add","item":{"path":"/src/b.cs"}}]}' > "$TEST_TEMP_DIR/changes.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/iters.json" "$TEST_TEMP_DIR/changes.json" > "$TEST_TEMP_DIR/pages.queue"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" run azure_run provider_prs_diff "" 12
    [ "$status" -eq 0 ]
    [ "$(jq -sc 'map(.path)' <<< "$output")" = '["/src/a.cs","/src/b.cs"]' ]
    [ "$(jq -r 'select(.path=="/src/b.cs") | .changeType' <<< "$output")" = "add" ]
}

@test "provider_prs_create without a repository fails defined" {
    run azure_run provider_prs_create "" --title "New PR" --head feature/y --base master
    [ "$status" -ne 0 ]
    [[ "$output" =~ "repository is required" ]]
}

@test "provider_prs_create requires title, head and base" {
    run azure_run provider_prs_create "" --title "only title"
    [ "$status" -ne 0 ]
    [[ "$output" =~ "--head" ]]
}

@test "provider_prs_merge completes with one PATCH whose completionOptions carry strategy and branch deletion" {
    printf '{"pullRequestId":12,"status":"completed","lastMergeSourceCommit":{"commitId":"abc123"}}' > "$TEST_TEMP_DIR/merged.json"
    : > "$TEST_TEMP_DIR/merge.body"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/merged.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/merge.body" \
        run azure_run provider_prs_merge repo1 12 --rebase --delete-branch
    [ "$status" -eq 0 ]
    # exactly one body carries a status: the completion PATCH (no separate strategy PATCH)
    [ "$(jq -s '[.[] | select(has("status"))] | length' "$TEST_TEMP_DIR/merge.body")" -eq 1 ]
    jq -s -e 'any(.[]; .status == "completed" and .lastMergeSourceCommit.commitId == "abc123"
        and .completionOptions.mergeStrategy == "rebase" and .completionOptions.deleteSourceBranch == true)' \
        "$TEST_TEMP_DIR/merge.body" >/dev/null
}

@test "provider_prs_merge puts subject and body into one mergeCommitMessage and --admin into bypassPolicy" {
    printf '{"pullRequestId":12,"status":"completed","lastMergeSourceCommit":{"commitId":"abc123"}}' > "$TEST_TEMP_DIR/merged.json"
    : > "$TEST_TEMP_DIR/merge.body"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/merged.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/merge.body" \
        run azure_run provider_prs_merge repo1 12 --merge --admin --subject "Title" --body "Details"
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[]; .completionOptions.mergeStrategy == "noFastForward" and .completionOptions.bypassPolicy == true
        and .completionOptions.mergeCommitMessage == "Title\n\nDetails")' "$TEST_TEMP_DIR/merge.body" >/dev/null
}

# Completion is asynchronous: right after the PATCH the PR is still active with
# mergeStatus queued. The verb polls until it is completed.
queue_pages() {   # queue_pages <file>...
    : > "$TEST_TEMP_DIR/pages.queue"
    local f
    for f in "$@"; do printf '%s\n' "$f" >> "$TEST_TEMP_DIR/pages.queue"; done
}

@test "provider_prs_merge polls a queued completion until the PR is completed" {
    printf '{"pullRequestId":12,"status":"active","mergeStatus":"succeeded","lastMergeSourceCommit":{"commitId":"abc123"}}' > "$TEST_TEMP_DIR/active.json"
    printf '{"pullRequestId":12,"status":"active","mergeStatus":"queued","lastMergeSourceCommit":{"commitId":"abc123"}}' > "$TEST_TEMP_DIR/queued.json"
    printf '{"pullRequestId":12,"status":"completed","mergeStatus":"succeeded","lastMergeSourceCommit":{"commitId":"abc123"}}' > "$TEST_TEMP_DIR/done.json"
    # GET (commit id), PATCH response, poll, poll
    queue_pages "$TEST_TEMP_DIR/active.json" "$TEST_TEMP_DIR/queued.json" "$TEST_TEMP_DIR/queued.json" "$TEST_TEMP_DIR/done.json"
    AZURE_PR_MERGE_POLL_INTERVAL=0 STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" \
        run azure_run provider_prs_merge repo1 12 --rebase
    [ "$status" -eq 0 ]
    [ "$(jq -r '.status' <<< "$output")" = "completed" ]
}

@test "provider_prs_merge reports mergeFailureMessage when the completion fails" {
    printf '{"pullRequestId":12,"status":"active","mergeStatus":"succeeded","lastMergeSourceCommit":{"commitId":"abc123"}}' > "$TEST_TEMP_DIR/active.json"
    printf '{"pullRequestId":12,"status":"active","mergeStatus":"queued","lastMergeSourceCommit":{"commitId":"abc123"}}' > "$TEST_TEMP_DIR/queued.json"
    printf '{"pullRequestId":12,"status":"active","mergeStatus":"conflicts","mergeFailureType":"caseSensitivityConflict","mergeFailureMessage":"File a.txt conflicts","lastMergeSourceCommit":{"commitId":"abc123"}}' > "$TEST_TEMP_DIR/failed.json"
    queue_pages "$TEST_TEMP_DIR/active.json" "$TEST_TEMP_DIR/queued.json" "$TEST_TEMP_DIR/failed.json"
    AZURE_PR_MERGE_POLL_INTERVAL=0 STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" \
        run azure_run provider_prs_merge repo1 12 --rebase
    [ "$status" -ne 0 ]
    [[ "$output" == *"File a.txt conflicts"* ]]
}

@test "provider_prs_merge fails with the PR's state when completion never lands" {
    printf '{"pullRequestId":12,"status":"active","mergeStatus":"queued","lastMergeSourceCommit":{"commitId":"abc123"}}' > "$TEST_TEMP_DIR/queued.json"
    AZURE_PR_MERGE_POLL_ATTEMPTS=2 AZURE_PR_MERGE_POLL_INTERVAL=0 STUB_CURL_RESPONSE="$TEST_TEMP_DIR/queued.json" \
        run azure_run provider_prs_merge repo1 12 --rebase
    [ "$status" -ne 0 ]
    [[ "$output" == *"not completed"* ]]
    [[ "$output" == *"queued"* ]]
}

@test "provider_prs_merge fails when the PR was abandoned instead of completed" {
    printf '{"pullRequestId":12,"status":"abandoned","lastMergeSourceCommit":{"commitId":"abc123"}}' > "$TEST_TEMP_DIR/ab.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/ab.json" run azure_run provider_prs_merge repo1 12 --rebase
    [ "$status" -ne 0 ]
    [[ "$output" == *"abandoned"* ]]
}

@test "provider_prs_merge --squash maps to the squash strategy" {
    printf '{"pullRequestId":12,"status":"completed","lastMergeSourceCommit":{"commitId":"abc123"}}' > "$TEST_TEMP_DIR/m2.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/m2.json" \
        run azure_run provider_prs_merge repo1 12 --squash
    [ "$status" -eq 0 ]
}

@test "provider_prs_merge without a repository fails defined" {
    run azure_run provider_prs_merge "" 12 --rebase
    [ "$status" -ne 0 ]
    [[ "$output" =~ "repository is required" ]]
}

@test "provider_prs_comment creates a thread with no status, so it can neither block a comment-resolution policy nor read as resolved" {
    printf '{"id":900}' > "$TEST_TEMP_DIR/c.json"
    : > "$TEST_TEMP_DIR/cbody.log"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/c.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/cbody.log" \
        run azure_run provider_prs_comment "" 12 --body "fyi"
    [ "$status" -eq 0 ]
    run ! grep -q '"status"' "$TEST_TEMP_DIR/cbody.log"
}

@test "a plain pr-comment thread (no status, no file) is not a review thread; status-bearing and inline threads are" {
    cat > "$TEST_TEMP_DIR/th-mix.json" <<'JSON'
{"value":[
 {"id":1,"comments":[{"id":1,"content":"plain comment","author":{"displayName":"a"}}]},
 {"id":2,"status":"unknown","comments":[{"id":1,"content":"unknown status","author":{"displayName":"a"}}]},
 {"id":3,"status":"active","comments":[{"id":1,"content":"general review thread","author":{"displayName":"a"}}]},
 {"id":4,"comments":[{"id":1,"content":"inline, no status","author":{"displayName":"a"}}],"threadContext":{"filePath":"/a.cs","rightFileStart":{"line":3,"offset":1}}},
 {"id":5,"status":"fixed","comments":[{"id":1,"content":"done","author":{"displayName":"a"}}]}]}
JSON
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/th-mix.json" run azure_run provider_prs_threads_page o1/p1/r1 12
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -r '[.data.repository.pullRequest.reviewThreads.nodes[].id] | join(",")')" = "12/3,12/4,12/5" ]
    [ "$(printf '%s' "$output" | jq -r '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.id == "12/5") | .isResolved][0]')" = "true" ]
    [ "$(printf '%s' "$output" | jq -r '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.id == "12/3") | .isResolved][0]')" = "false" ]
}

@test "a thread created by provider_prs_comment is absent from the review threads" {
    printf '{"value":[{"id":900,"comments":[{"id":1,"content":"fyi","author":{"displayName":"a"}}]}]}' > "$TEST_TEMP_DIR/th-comment.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/th-comment.json" run azure_run provider_prs_threads_page o1/p1/r1 12
    [ "$(printf '%s' "$output" | jq -r '.data.repository.pullRequest.reviewThreads.nodes | length')" = "0" ]
}

@test "provider_prs_comment posts a thread and prints its bare thread id" {
    printf '{"id":77,"status":1}' > "$TEST_TEMP_DIR/thread.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/thread.json" \
        run azure_run provider_prs_comment "" 12 --body "ship it"
    [ "$status" -eq 0 ]
    [ "$output" = "77" ]
    grep -q "pullrequests/12/threads" "$STUB_CALL_LOG"
}

@test "provider_prs_diff lists changed paths with --name-only" {
    printf '{"value":[{"id":3}]}' > "$TEST_TEMP_DIR/iters.json"
    printf '{"changes":[{"item":{"path":"/src/a.cs"}},{"item":{"path":"/src/b.cs"}}]}' > "$TEST_TEMP_DIR/changes.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/iters.json" "$TEST_TEMP_DIR/changes.json" > "$TEST_TEMP_DIR/pages.queue"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/pages.queue" \
        run azure_run provider_prs_diff "" 12 --name-only
    [ "$status" -eq 0 ]
    [[ "$output" =~ "/src/a.cs" ]]
    [[ "$output" =~ "/src/b.cs" ]]
}

# Thread shapes as Azure returns them: id, a string status, threadContext (null for a
# general thread), commentType "text" for people and "system" for Azure's own notes.
@test "provider_prs_threads_page maps an inline thread's file and line from threadContext" {
    cat > "$TEST_TEMP_DIR/inline.json" <<'JSON'
{"value":[{"id":7,"status":"active","isDeleted":false,
  "threadContext":{"filePath":"/src/a.cs","rightFileStart":{"line":12,"offset":1},"rightFileEnd":{"line":12,"offset":5}},
  "comments":[{"id":1,"parentCommentId":0,"content":"nit","commentType":"text","author":{"displayName":"Ann"}}]}]}
JSON
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/inline.json" run azure_run provider_prs_threads_page org/proj/repo1 12
    [ "$status" -eq 0 ]
    jq -e '.data.repository.pullRequest.reviewThreads.nodes[0] | .id == "12/7" and .path == "/src/a.cs" and .line == 12' <<< "$output" >/dev/null
}

@test "provider_prs_threads_page maps a left-side inline thread's line" {
    cat > "$TEST_TEMP_DIR/left.json" <<'JSON'
{"value":[{"id":8,"status":"active","isDeleted":false,
  "threadContext":{"filePath":"/src/a.cs","leftFileStart":{"line":4,"offset":1}},
  "comments":[{"id":1,"parentCommentId":0,"content":"old line","commentType":"text","author":{"displayName":"Ann"}}]}]}
JSON
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/left.json" run azure_run provider_prs_threads_page org/proj/repo1 12
    jq -e '.data.repository.pullRequest.reviewThreads.nodes[0].line == 4' <<< "$output" >/dev/null
}

@test "provider_prs_threads_page drops system threads and deleted threads" {
    cat > "$TEST_TEMP_DIR/mixed.json" <<'JSON'
{"value":[
 {"id":1,"status":"active","isDeleted":false,"threadContext":null,
  "comments":[{"id":1,"parentCommentId":0,"content":"Ann updated the PR","commentType":"system","author":{"displayName":"Ann"}}]},
 {"id":2,"status":"active","isDeleted":true,"threadContext":null,
  "comments":[{"id":1,"parentCommentId":0,"content":"gone","commentType":"text","author":{"displayName":"Ann"}}]},
 {"id":3,"status":"closed","isDeleted":false,"threadContext":null,
  "comments":[{"id":1,"parentCommentId":0,"content":"kept","commentType":"text","author":{"displayName":"Ann"}}]}]}
JSON
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/mixed.json" run azure_run provider_prs_threads_page org/proj/repo1 12
    [ "$status" -eq 0 ]
    [ "$(jq -c '[.data.repository.pullRequest.reviewThreads.nodes[].id]' <<< "$output")" = '["12/3"]' ]
    jq -e '.data.repository.pullRequest.reviewThreads.nodes[0].isResolved == true' <<< "$output" >/dev/null
}

@test "provider_prs_threads_page treats every status other than active and pending as resolved" {
    local st
    for st in fixed wontFix closed byDesign; do
        printf '{"value":[{"id":1,"status":"%s","isDeleted":false,"threadContext":null,"comments":[{"id":1,"parentCommentId":0,"content":"c","commentType":"text","author":{"displayName":"A"}}]}]}' "$st" > "$TEST_TEMP_DIR/st.json"
        STUB_CURL_RESPONSE="$TEST_TEMP_DIR/st.json" run azure_run provider_prs_threads_page org/proj/repo1 12
        jq -e '.data.repository.pullRequest.reviewThreads.nodes[0].isResolved == true' <<< "$output" >/dev/null || { echo "not resolved: $st"; return 1; }
    done
    for st in active pending; do
        printf '{"value":[{"id":1,"status":"%s","isDeleted":false,"threadContext":null,"comments":[{"id":1,"parentCommentId":0,"content":"c","commentType":"text","author":{"displayName":"A"}}]}]}' "$st" > "$TEST_TEMP_DIR/st.json"
        STUB_CURL_RESPONSE="$TEST_TEMP_DIR/st.json" run azure_run provider_prs_threads_page org/proj/repo1 12
        jq -e '.data.repository.pullRequest.reviewThreads.nodes[0].isResolved == false' <<< "$output" >/dev/null || { echo "resolved: $st"; return 1; }
    done
}

@test "provider_prs_threads_page with a cursor emits an empty final page" {
    run azure_run provider_prs_threads_page org/proj/repo1 12 CURSOR
    [ "$status" -eq 0 ]
    printf '%s\n' "$output" | jq -e '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage == false' >/dev/null
}

@test "provider_prs_thread_resolve without a repo fails defined when none can be resolved (routes are repositories-qualified)" {
    cd "$TEST_TEMP_DIR"; unset DEVENV_REPO
    run azure_run provider_prs_thread_resolve 12/5
    [ "$status" -ne 0 ]
    [[ "$output" =~ repositories-qualified ]]
}

@test "provider_prs_thread_resolve without a composite ref fails with guidance" {
    run azure_run provider_prs_thread_resolve o1/p1/r1 5
    [ "$status" -ne 0 ]
    [[ "$output" =~ pr-threads-get ]]
}

@test "provider_prs_thread_resolve builds a repositories-qualified route" {
    # F-SMOKE-5 regression, live-corrected: thread routes are
    # repositories-qualified — the project-git base (no repositories
    # segment) is an MVC 404. Repo form: <repo>/<pr>/<thread>.
    printf '{"id":5,"status":2}' > "$TEST_TEMP_DIR/resolved2.json"
    : > "$TEST_TEMP_DIR/resolve2.body"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resolved2.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/resolve2.body" \
        run azure_run provider_prs_thread_resolve o1/p1/r1 12/5
    [ "$status" -eq 0 ]
    grep -q "dev.azure.com/o1/p1/_apis/git/repositories/r1/pullrequests/12/threads/5" "$STUB_CALL_LOG"
    # Live-verified: the status PATCH takes the thread object {status: 2} —
    # a JSON-Patch array fails with "Parameter name: commentThread".
    grep -q '"status"' "$TEST_TEMP_DIR/resolve2.body"
    ! grep -q '"op"' "$TEST_TEMP_DIR/resolve2.body"
}


@test "provider_prs_thread_resolve takes the <pr>/<thread> ref from pr-threads-get and routes it to the resolved repo" {
    printf '{"id":5,"status":"fixed"}' > "$TEST_TEMP_DIR/fixed.json"
    DEVENV_REPO=p1/r1 STUB_CURL_RESPONSE="$TEST_TEMP_DIR/fixed.json" run azure_run provider_prs_thread_resolve 12/5
    [ "$status" -eq 0 ]
    [ "$output" = "true" ]
    grep -q "dev.azure.com/org/p1/_apis/git/repositories/r1/pullrequests/12/threads/5" "$STUB_CALL_LOG"
}

@test "provider_prs_thread_resolve reports unknown when the thread is still active after the PATCH" {
    printf '{"id":5,"status":"active"}' > "$TEST_TEMP_DIR/still.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/still.json" run azure_run provider_prs_thread_resolve o1/p1/r1 12/5
    [ "$status" -eq 0 ]
    [ "$output" = "unknown" ]
}

@test "provider_prs_thread_resolve sets the thread status by name, which Azure accepts as a string" {
    printf '{"id":5,"status":"fixed"}' > "$TEST_TEMP_DIR/fixed.json"
    : > "$TEST_TEMP_DIR/resolve.body"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/fixed.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/resolve.body" \
        run azure_run provider_prs_thread_resolve o1/p1/r1 12/5
    jq -s -e 'any(.[]; .status == "fixed")' "$TEST_TEMP_DIR/resolve.body" >/dev/null
}

@test "provider_prs_thread_reply replies under the named comment: <thread>/<comment> sets parentCommentId" {
    printf '{"id":3}' > "$TEST_TEMP_DIR/reply.json"
    : > "$TEST_TEMP_DIR/reply.body"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/reply.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/reply.body" \
        run azure_run provider_prs_thread_reply o1/p1/r1 12 62644/2 "reply text"
    [ "$status" -eq 0 ]
    grep -q "pullrequests/12/threads/62644/comments" "$STUB_CALL_LOG"
    jq -s -e 'any(.[]; .parentCommentId == 2 and .content == "reply text")' "$TEST_TEMP_DIR/reply.body" >/dev/null
}

@test "provider_prs_thread_reply with a bare thread id replies under the thread's first comment" {
    printf '{"id":3}' > "$TEST_TEMP_DIR/reply.json"
    : > "$TEST_TEMP_DIR/reply.body"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/reply.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/reply.body" \
        run azure_run provider_prs_thread_reply o1/p1/r1 12 5 "reply text"
    [ "$status" -eq 0 ]
    jq -s -e 'any(.[]; .parentCommentId == 1)' "$TEST_TEMP_DIR/reply.body" >/dev/null
}

@test "provider_prs_thread_reply refuses a comment ref that is not <thread> or <thread>/<comment>" {
    run azure_run provider_prs_thread_reply o1/p1/r1 12 "abc" "reply text"
    [ "$status" -ne 0 ]
    [[ "$output" == *"pr-threads-get"* ]]
}

@test "provider_prs_thread_reply posts a bare comment object (no threads envelope)" {
    # F-SMOKE-4 regression: the comments endpoint takes {content,...} —
    # the threads envelope made the store read empty content.
    printf '{"id":77}' > "$TEST_TEMP_DIR/reply.json"
    : > "$TEST_TEMP_DIR/rreqbody.log"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/reply.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/rreqbody.log" \
        run azure_run provider_prs_thread_reply o1/p1/r1 12 5 "reply text"
    [ "$status" -eq 0 ]
    grep -q '"content"' "$TEST_TEMP_DIR/rreqbody.log"
    ! grep -q '"comments"' "$TEST_TEMP_DIR/rreqbody.log"
}

@test "provider_prs_diff returns empty (not a jq crash) when .changes is null" {
    printf '{"value":[{"id":1,"changes":null}]}' > "$TEST_TEMP_DIR/nochanges.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/nochanges.json" \
        run azure_run provider_prs_diff o1/p1/r1 12
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

# ============================================================================
# provider_prs_thread_create (contract verb)
# ============================================================================

@test "provider_prs_thread_create posts a general thread and emits gh-shaped JSON" {
    printf '{"id":555,"status":1}' > "$TEST_TEMP_DIR/thread.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/thread.json" \
        run azure_run provider_prs_thread_create o1/p1/r1 12 --body "note"
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -r '.thread.id')" = "12/555" ]
    # the contract's output: a URL (the PR page at the discussion)
    [ "$(printf '%s' "$output" | jq -r '.thread.url')" = "https://dev.azure.com/o1/p1/_git/r1/pullrequest/12?discussionId=555" ]
}

@test "provider_prs_thread_create output satisfies what pr-review-comment reads (.thread.url)" {
    printf '{"id":558,"status":1}' > "$TEST_TEMP_DIR/thread4.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/thread4.json" \
        run azure_run provider_prs_thread_create o1/p1/r1 12 --body "note" --path a.cs --line 3
    [ "$status" -eq 0 ]
    grep -q "thread.url // empty" "$PROJECT_ROOT/tools/scripts/pr-review-comment.sh"
    [ -n "$(printf '%s' "$output" | jq -r '.thread.url // empty')" ]
}

@test "provider_prs_thread_create output carries a URL even when the repository is unnamed" {
    printf '{"id":557,"status":1}' > "$TEST_TEMP_DIR/thread3.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/thread3.json" \
        run azure_run provider_prs_thread_create "" 12 --body "note"
    [ "$status" -eq 0 ]
    [[ "$(printf '%s' "$output" | jq -r '.thread.url')" == *"/pullrequests/12/threads/557" ]]
}

@test "provider_prs_thread_create includes threadContext for inline threads" {
    printf '{"id":556,"status":1}' > "$TEST_TEMP_DIR/thread2.json"
    : > "$TEST_TEMP_DIR/treqbody.log"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/thread2.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/treqbody.log" \
        run azure_run provider_prs_thread_create o1/p1/r1 12 --body "inline" --path src/x.cs --line 42
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -r '.thread.id')" = "12/556" ]
    # Live-verified shape: offset >= 1 is mandatory (0 draws a 400 range error).
    # The payload is pretty-printed JSON — assert field-wise, not byte-wise.
    jq -e '.threadContext.rightFileStart == {"line": 42, "offset": 1}' < <(tail -n +2 "$TEST_TEMP_DIR/treqbody.log" | head -n -1) >/dev/null 2>&1 || \
        grep -q '"offset": *1' "$TEST_TEMP_DIR/treqbody.log"
}

@test "provider_prs_thread_create requires --body" {
    run azure_run provider_prs_thread_create o1/p1/r1 12
    [ "$status" -ne 0 ]
    [[ "$output" =~ "--body" ]]
}

@test "provider_prs_thread_create rejects --path without --line" {
    run azure_run provider_prs_thread_create o1/p1/r1 12 --body "x" --path a/b
    [ "$status" -ne 0 ]
}

@test "provider_prs_view --json DEFAULT_FIELDS returns zero nulls (projection contract)" {
    # The zero-null contract: every field pr-get's DEFAULT_FIELDS names must
    # exist and be non-null in the mapped projection.
    pr_payload > "$TEST_TEMP_DIR/pr.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/pr.json" \
        run azure_run provider_prs_view "" 12 --json number,title,body,state,isDraft,headRefName,baseRefName,author,labels,assignees,reviewRequests,milestone,mergeable,mergeStateStatus,url,createdAt,updatedAt,closedAt,mergedAt,comments,reviews
    [ "$status" -eq 0 ]
    local nulls
    nulls=$(jq '[.[] | select(. == null)] | length' <<< "$output")
    [ "$nulls" -eq 0 ]
    # mergeable/mergeStateStatus map from mergeStatus per the contract.
    [[ "$(jq -r .mergeable <<< "$output")" == "MERGEABLE" ]]
}


@test "provider_prs_list encodes a branch name with a space or an ampersand in the query" {
    printf '{"value":[]}' > "$TEST_TEMP_DIR/none.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/none.json" run azure_run provider_prs_list proj/repo1 --state open --head "feat/a b&c"
    [ "$status" -eq 0 ]
    grep -q 'sourceRefName=refs%2Fheads%2Ffeat%2Fa%20b%26c' "$STUB_CALL_LOG"
}

@test "azure_pr_base encodes org, project and repo names, and takes the org of a three-part spec" {
    run azure_run azure_pr_base "my org/my proj/my repo"
    [ "$output" = "https://dev.azure.com/my%20org/my%20proj/_apis/git/repositories/my%20repo" ]
    run azure_run azure_pr_base "p 1/r 1"
    [ "$output" = "https://dev.azure.com/org/p%201/_apis/git/repositories/r%201" ]
}

@test "provider_prs_diff reads every page of changes and stops when nextSkip is 0" {
    printf '{"value":[{"id":1},{"id":2}]}' > "$TEST_TEMP_DIR/iters.json"
    printf '{"changes":[{"item":{"path":"/a.cs"},"changeType":"edit"},{"item":{"path":"/b.cs"},"changeType":"add"}],"nextSkip":2,"nextTop":2}' > "$TEST_TEMP_DIR/ch1.json"
    printf '{"changes":[{"item":{"path":"/c.cs"},"changeType":"delete"}],"nextSkip":0,"nextTop":0}' > "$TEST_TEMP_DIR/ch2.json"
    printf '%s\n%s\n%s\n' "$TEST_TEMP_DIR/iters.json" "$TEST_TEMP_DIR/ch1.json" "$TEST_TEMP_DIR/ch2.json" > "$TEST_TEMP_DIR/diff.pages"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/diff.pages" run azure_run provider_prs_diff "" 12 --name-only
    [ "$status" -eq 0 ]
    [ "$output" = $'/a.cs\n/b.cs\n/c.cs' ]
}

@test "provider_prs_diff does not loop when the server repeats its position" {
    printf '{"value":[{"id":1}]}' > "$TEST_TEMP_DIR/iters2.json"
    printf '{"changes":[{"item":{"path":"/a.cs"},"changeType":"edit"}],"nextSkip":0}' > "$TEST_TEMP_DIR/ch-same.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/iters2.json" "$TEST_TEMP_DIR/ch-same.json" > "$TEST_TEMP_DIR/diff2.pages"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/diff2.pages" run azure_run provider_prs_diff "" 12 --name-only
    [ "$status" -eq 0 ]
    [ "$output" = "/a.cs" ]
}

@test "provider_prs_view rejects a malformed or unknown --json field by name, and prints nothing for a null -q result" {
    printf '%s' '{"pullRequestId":12,"title":"t","status":"active","sourceRefName":"refs/heads/f","targetRefName":"refs/heads/m","repository":{"webUrl":"https://dev.azure.com/org/proj/_git/r"}}' > "$TEST_TEMP_DIR/pr1.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/pr1.json" run azure_run provider_prs_view "" 12 --json 'title,nope'
    [ "$status" -ne 0 ]
    [[ "$output" == *"unknown JSON field 'nope'"* ]]
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/pr1.json" run azure_run provider_prs_view "" 12 --json 'title}; input'
    [ "$status" -ne 0 ]
    [[ "$output" == *"comma-separated list of field names"* ]]
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/pr1.json" run azure_run provider_prs_view "" 12 --json mergedAt -q '.missing'
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "provider_prs_list rejects an unknown --json field by name" {
    printf '{"value":[{"pullRequestId":12,"title":"t","status":"active","sourceRefName":"refs/heads/f","targetRefName":"refs/heads/m","repository":{"webUrl":"https://dev.azure.com/org/proj/_git/r"}}]}' > "$TEST_TEMP_DIR/prs-f.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/prs-f.json" run azure_run provider_prs_list "" --json 'number,bogus'
    [ "$status" -ne 0 ]
    [[ "$output" == *"unknown JSON field 'bogus'"* ]]
}

@test "a plain comment stays out of the review threads until someone replies in it, then it is listed" {
    cat > "$TEST_TEMP_DIR/th-reply.json" <<'JSON'
{"value":[
 {"id":1,"comments":[{"id":1,"content":"bot summary","author":{"displayName":"bot"}}]},
 {"id":2,"comments":[{"id":1,"content":"bot summary","author":{"displayName":"bot"}},{"id":2,"content":"human answer","author":{"displayName":"human"}}]},
 {"id":3,"comments":[{"id":1,"content":"merge policy","commentType":"system","author":{"displayName":"x"}},{"id":2,"content":"also system","commentType":"system","author":{"displayName":"x"}}]}]}
JSON
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/th-reply.json" run azure_run provider_prs_threads_page o1/p1/r1 12
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -r '[.data.repository.pullRequest.reviewThreads.nodes[].id] | join(",")')" = "12/2" ]
    [ "$(printf '%s' "$output" | jq -r '.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes | length')" = "2" ]
}

@test "the id pr-comment prints builds the ref thread resolve takes" {
    printf '{"id":77}' > "$TEST_TEMP_DIR/new-thread.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/new-thread.json" run azure_run provider_prs_comment o1/p1/r1 12 --body "x"
    local id="$output"
    [ "$id" = "77" ]
    printf '{"id":77,"status":"fixed"}' > "$TEST_TEMP_DIR/resolved.json"
    : > "$STUB_CALL_LOG"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resolved.json" run azure_run provider_prs_thread_resolve o1/p1/r1 "12/$id"
    [ "$status" -eq 0 ]
    grep -q 'pullrequests/12/threads/77' "$STUB_CALL_LOG"
}
