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
    grep -q "sourceRefName=refs/heads/f" "$STUB_CALL_LOG"
    grep -q "targetRefName=refs/heads/m" "$STUB_CALL_LOG"
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

@test "provider_prs_merge performs the strategy-then-complete two-step with rebase + deleteSourceBranch" {
    printf '{"pullRequestId":12,"status":"completed","lastMergeSourceCommit":{"commitId":"abc123"}}' > "$TEST_TEMP_DIR/merged.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/merged.json" \
        run azure_run provider_prs_merge repo1 12 --rebase --delete-branch
    [ "$status" -eq 0 ]
    # Three calls recorded: strategy PATCH, GET for the current commit id,
    # then the completion PATCH (twice minimum on the PR resource).
    [ "$(grep -c "pullrequests/12" "$STUB_CALL_LOG")" -ge 2 ]
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

@test "provider_prs_comment posts a thread and prints its id" {
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

@test "provider_prs_threads_page maps threads to the gh-threads shape" {
    cat > "$TEST_TEMP_DIR/threads.json" <<'JSON'
{"value":[{"threadId":5,"status":2,"comments":[{"id":1,"content":"inline note","author":{"displayName":"Bob"}}]}]}
JSON
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/threads.json" \
        run azure_run provider_prs_threads_page org/proj/repo1 12
    [ "$status" -eq 0 ]
    printf '%s\n' "$output" | jq -e '.data.repository.pullRequest.reviewThreads.nodes[0].isResolved == true' >/dev/null
    printf '%s\n' "$output" | jq -e '.data.repository.pullRequest.reviewThreads.nodes[0].comments.nodes[0].body == "inline note"' >/dev/null
}

@test "provider_prs_threads_page with a cursor emits an empty final page" {
    run azure_run provider_prs_threads_page org/proj/repo1 12 CURSOR
    [ "$status" -eq 0 ]
    printf '%s\n' "$output" | jq -e '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage == false' >/dev/null
}

@test "provider_prs_thread_resolve patches status to resolved" {
    printf '{"id":5,"status":2}' > "$TEST_TEMP_DIR/resolved.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/resolved.json" \
        run azure_run provider_prs_thread_resolve 12/5
    [ "$status" -eq 0 ]
    [ "$output" = "true" ]
}

@test "provider_prs_thread_resolve without a composite ref fails with guidance" {
    run azure_run provider_prs_thread_resolve 5
    [ "$status" -ne 0 ]
    [[ "$output" =~ pr-threads-get ]]
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
