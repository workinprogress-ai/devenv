#!/usr/bin/env bats
# Tests for the azure provider pipelines domain: run list/view field mapping,
# workflow list, trigger (definition id or name), rerun/cancel, artifacts
# metadata, and the branch-settle wait loop. All transport via stub_curl.

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
    source "$DEVENV_TOOLS/lib/providers/azure/pipelines.bash"
}
azure_run() {
    azure_libs_source
    "$@"
}

build_page() {
    cat <<'JSON'
{"value":[
  {"id":9001,"buildNumber":"20260927.1","status":"completed","result":"succeeded",
   "sourceBranch":"refs/heads/master","sourceVersion":"abc123","queueTime":"2026-09-27T09:00:00Z",
   "definition":{"name":"CI"},"url":"https://dev.azure.com/org/proj/_apis/build/builds/9001"},
  {"id":9002,"buildNumber":"20260927.2","status":"inProgress","result":null,
   "sourceBranch":"refs/heads/feature/x","sourceVersion":"def456","queueTime":"2026-09-27T09:05:00Z",
   "definition":{"name":"CI"},"url":"https://dev.azure.com/org/proj/_apis/build/builds/9002"}
]}
JSON
}

@test "provider_pipelines_run_list maps builds to the seam run shape (one JSON array)" {
    build_page > "$TEST_TEMP_DIR/builds.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/builds.json" \
        run azure_run provider_pipelines_run_list proj/repo1 --branch feature/x --limit 5
    [ "$status" -eq 0 ]
    # One JSON array — consumers index with .[0]/.[1] directly (the
    # pipelines-run/status wrappers select .[0].url).
    local mapped="$output"
    [[ "$(jq 'length' <<< "$mapped")" == "2" ]]
    jq -e '.[0].id == "9001" and .[0].status == "completed" and .[0].conclusion == "success" and .[0].branch == "master"' <<< "$mapped" >/dev/null
    jq -e '.[1].id == "9002" and .[1].status == "in_progress" and .[1].conclusion == null and .[1].branch == "feature/x"' <<< "$mapped" >/dev/null
    # Branch filter and limit became query params
    grep -q "branchName=refs/heads/feature/x" "$STUB_CALL_LOG"
    grep -q 'top=5' "$STUB_CALL_LOG"
}

@test "provider_pipelines_run_list --json projects only the requested fields" {
    build_page > "$TEST_TEMP_DIR/builds.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/builds.json" \
        run azure_run provider_pipelines_run_list proj/repo1 --json url,status
    [ "$status" -eq 0 ]
    # Projection keeps exactly the requested keys, array shape intact.
    jq -e 'length == 2 and (.[0] | keys | sort) == ["status","url"]' <<< "$output" >/dev/null
}

@test "provider_pipelines_run_list -q applies once over the whole array (gh list semantics)" {
    build_page > "$TEST_TEMP_DIR/builds.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/builds.json" \
        run azure_run provider_pipelines_run_list proj/repo1 -q '[.[] | .url]'
    [ "$status" -eq 0 ]
    jq -e 'length == 2 and .[0] == "https://dev.azure.com/org/proj/_apis/build/builds/9001"' <<< "$output" >/dev/null
}

@test "provider_pipelines_run_list -q list-level select/count works (wait_for_workflow_runs shape)" {
    # provider-loader passes list-level programs like
    # '[.[] | select(.status == "queued")] | length' — per-record
    # application made every record yield 0 and the waiter time out.
    build_page > "$TEST_TEMP_DIR/builds.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/builds.json" \
        run azure_run provider_pipelines_run_list proj/repo1 -q '[.[] | select(.status == "in_progress")] | length'
    [ "$status" -eq 0 ]
    [ "$output" = "1" ]
}

@test "provider_pipelines_run_view maps a single build" {
    printf '{"id":9001,"buildNumber":"b1","status":"completed","result":"failed","sourceBranch":"refs/heads/master","sourceVersion":"abc","queueTime":"t","definition":{"name":"CI"},"url":"u"}' > "$TEST_TEMP_DIR/one.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/one.json" \
        run azure_run provider_pipelines_run_view "" 9001
    [ "$status" -eq 0 ]
    printf '%s\n' "$output" | jq -e '.id == "9001" and .conclusion == "failure"' >/dev/null
}

@test "provider_pipelines_workflow_list maps definitions" {
    cat > "$TEST_TEMP_DIR/defs.json" <<'JSON'
{"value":[{"id":7,"name":"CI","path":"ci"},{"id":8,"name":"Release","path":"release"}]}
JSON
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/defs.json" \
        run azure_run provider_pipelines_workflow_list proj/repo1
    [ "$status" -eq 0 ]
    # One JSON array of mapped definitions.
    jq -e 'length == 2 and .[0].id == "7" and .[0].name == "CI"' <<< "$output" >/dev/null
    grep -q "build/definitions" "$STUB_CALL_LOG"
}

@test "provider_pipelines_workflow_run queues a build by definition id" {
    printf '{"id":9010}' > "$TEST_TEMP_DIR/queued.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/queued.json" \
        run azure_run provider_pipelines_workflow_run "" 7 --ref master
    [ "$status" -eq 0 ]
    [ "$output" = "9010" ]
    grep -q "_apis/build/builds" "$STUB_CALL_LOG"
}

@test "provider_pipelines_workflow_run without --ref resolves the default branch" {
    # No hard-coded master: the default ref comes from the repo view (a
    # main-default repo must queue on main). Two stub pages: the repos-view
    # GET first, then the queue POST.
    printf '{"defaultBranch":"refs/heads/main","name":"r1","project":{"name":"p1"}}' > "$TEST_TEMP_DIR/repo.json"
    printf '{"id":9011}' > "$TEST_TEMP_DIR/queued.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/repo.json" "$TEST_TEMP_DIR/queued.json" > "$TEST_TEMP_DIR/run.queue"
    : > "$TEST_TEMP_DIR/runbody.log"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/run.queue" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/runbody.log" \
        run azure_run provider_pipelines_workflow_run repo1 7
    [ "$status" -eq 0 ]
    grep -q '"refs/heads/main"' "$TEST_TEMP_DIR/runbody.log"
}

@test "provider_pipelines_workflow_run forwards --field inputs as parameters" {
    printf '{"defaultBranch":"refs/heads/main","name":"r1","project":{"name":"p1"}}' > "$TEST_TEMP_DIR/repo.json"
    printf '{"id":9012}' > "$TEST_TEMP_DIR/queued.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/repo.json" "$TEST_TEMP_DIR/queued.json" > "$TEST_TEMP_DIR/f.queue"
    : > "$TEST_TEMP_DIR/fbody.log"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/f.queue" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/fbody.log" \
        run azure_run provider_pipelines_workflow_run repo1 7 --field environment=staging --field dry-run=true
    [ "$status" -eq 0 ]
    # parameters is a STRING holding serialized JSON (the REST Build
    # contract's typing) — parse it back to verify the inputs, including a
    # dash-spelled key.
    jq -e '(.parameters | fromjson).environment == "staging" and (.parameters | fromjson)["dry-run"] == "true"' \
        < "$TEST_TEMP_DIR/fbody.log"
}

@test "provider_pipelines_run_list --status becomes a statusFilter query param" {
    build_page > "$TEST_TEMP_DIR/builds.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/builds.json" \
        run azure_run provider_pipelines_run_list repo1 --status in_progress --limit 5
    [ "$status" -eq 0 ]
    grep -q "statusFilter=inProgress" "$STUB_CALL_LOG"
}

@test "provider_pipelines_workflow_run without a workflow fails defined" {
    run azure_run provider_pipelines_workflow_run "" ""
    [ "$status" -ne 0 ]
    [[ "$output" =~ "definition" ]]
}

@test "provider_pipelines_run_rerun posts to the build endpoint" {
    printf '{"id":9001}' > "$TEST_TEMP_DIR/rerun.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/rerun.json" \
        run azure_run provider_pipelines_run_rerun "" 9001
    [ "$status" -eq 0 ]
}

@test "provider_pipelines_run_cancel patches status=cancelling" {
    printf '{"id":9002,"status":"cancelling"}' > "$TEST_TEMP_DIR/cancel.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/cancel.json" \
        run azure_run provider_pipelines_run_cancel org/proj/repo1 9002
    [ "$status" -eq 0 ]
}

@test "provider_pipelines_run_artifacts maps artifact metadata" {
    printf '{"value":[{"id":3,"name":"drop","resource":{"downloadUrl":"https://dev.azure.com/org/abc","properties":{"file Size":4096}}} ]}' > "$TEST_TEMP_DIR/arts.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/arts.json" \
        run azure_run provider_pipelines_run_artifacts org/proj/repo1 9001
    [ "$status" -eq 0 ]
    # One JSON array; size_in_bytes is a number and url carries the link.
    jq -e 'length == 1 and .[0].id == "3" and .[0].name == "drop" and .[0].size_in_bytes == 4096 and .[0].url == "https://dev.azure.com/org/abc"' <<< "$output" >/dev/null
    grep -q "builds/9001/artifacts" "$STUB_CALL_LOG"
}

@test "provider_pipelines_wait_for_branch settles when no active runs" {
    # wait_for_branch consumes run_list's array output — feed the stub a
    # builds-shaped page so the mapping path runs end to end.
    printf '{"value":[{"id":1,"status":"completed","result":"succeeded","sourceBranch":"refs/heads/main","definition":{"name":"CI"}}]}' > "$TEST_TEMP_DIR/runs.json"
    printf '[provider]\nname=azure\nazure_org=o1\nazure_project=p1\n' > "$DEVENV_ROOT/devenv.config"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/runs.json" \
        run azure_run provider_pipelines_wait_for_branch o1/p1/r1 main 3
    [ "$status" -eq 0 ]
}

@test "azure_build_base composes a valid query for both repo forms" {
    # F-SMOKE-1 regression, live-corrected: neither form carries a bare
    # trailing '?' (Azure 400s 'builds?&…'); the verb's first param owns
    # the separator.
    azure_libs_source
    local url
    url=$(azure_build_base "")
    [[ "$url" == *"build/builds" ]]
    [[ "$url" != *"builds?" ]]
    url=$(azure_build_base "o1/p1/r1")
    [[ "$url" == *"build/builds?repositoryId=r1&repositoryType=TfsGit" ]]
}

@test "provider_pipelines_run_list composes the project-scoped URL without '?&'" {
    # Live-verified: 'builds?&$top=…' is rejected 400 by Azure.
    printf '{"value":[]}' > "$TEST_TEMP_DIR/empty-builds.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/empty-builds.json" \
        run azure_run provider_pipelines_run_list ""
    [ "$status" -eq 0 ]
    grep -q 'builds?$top=' "$STUB_CALL_LOG"
    ! grep -q 'builds?&' "$STUB_CALL_LOG"
}

@test "provider_pipelines_run_list emits the transport error JSON on failure" {
    # Error-contract regression: paginate's error JSON lands on stdout — the
    # verb must not swallow it (rc=1 with empty output was the old bug).
    printf '{"error":"http","code":404,"message":"list request failed"}' > "$TEST_TEMP_DIR/err.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/err.json" STUB_CURL_HTTP_CODE=404 \
        run azure_run provider_pipelines_run_list ""
    [ "$status" -ne 0 ]
    [[ "$output" =~ '"error":"http"' ]]
}

@test "provider_pipelines_workflow_list resolves the repo filter to a GUID" {
    # F-SMOKE-7 regression: the definitions filter takes a repository GUID,
    # not the bare name. Queue: [repo-guid GET, definitions GET].
    printf '{"id":"guid-1234","name":"r1"}' > "$TEST_TEMP_DIR/repo.json"
    printf '{"value":[]}' > "$TEST_TEMP_DIR/defs.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/repo.json" "$TEST_TEMP_DIR/defs.json" > "$TEST_TEMP_DIR/wf.queue"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/wf.queue" \
        run azure_run provider_pipelines_workflow_list "o1/p1/r1"
    [ "$status" -eq 0 ]
    grep -q "repositoryId=guid-1234" "$STUB_CALL_LOG"
}

# URL shape of the builds list: the query separator is '?' when the base carries no
# query (project-wide, no repo) and '&' when it does (repo-scoped). A wrong choice
# yields ".../builds&$top=..." (404) or a doubled '?'.

builds_url_for() {   # builds_url_for [repo-args...] -> the URL the verb requested
    build_page > "$TEST_TEMP_DIR/builds.json"
    : > "$STUB_CALL_LOG"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/builds.json" azure_run provider_pipelines_run_list "$@" >/dev/null
    grep -m1 '_apis/build/builds' "$STUB_CALL_LOG"
}

@test "run_list with no repo requests builds?\$top=… (separator '?', never 'builds&')" {
    url="$(builds_url_for --limit 7)"
    [[ "$url" == *'/_apis/build/builds?$top=7&queryOrder=queueTimeDescending'* ]]
    [[ "$url" != *'builds&'* ]]
}

@test "run_list with a repo appends \$top after the existing query with '&'" {
    url="$(builds_url_for proj/repo1 --limit 7)"
    [[ "$url" == *'/_apis/build/builds?repositoryId=repo1&repositoryType=TfsGit&$top=7'* ]]
}

@test "run_list URLs contain exactly one '?' before the api-version is appended" {
    for args in "--limit 3" "proj/repo1 --limit 3" "--branch main --limit 3" "proj/repo1 --branch main --status in_progress"; do
        # shellcheck disable=SC2086
        url="$(builds_url_for $args)"
        base="${url%%&api-version*}"
        [ "$(grep -o '?' <<<"$base" | wc -l)" -eq 1 ]
    done
}
