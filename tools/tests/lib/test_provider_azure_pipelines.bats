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

# A list page that also carries a top-level id, so one stubbed response answers both the
# repository lookup (whose GUID the builds filter takes) and the builds list itself.
build_page() {
    cat <<'JSON'
{"id":"guid-1234","value":[
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
    jq -e '.[0].id == 9001 and .[0].status == "completed" and .[0].conclusion == "success" and .[0].headBranch == "master"' <<< "$mapped" >/dev/null
    jq -e '.[1].id == 9002 and .[1].status == "in_progress" and .[1].conclusion == null and .[1].headBranch == "feature/x"' <<< "$mapped" >/dev/null
    # Branch filter and limit became query params
    grep -q "branchName=refs%2Fheads%2Ffeature%2Fx" "$STUB_CALL_LOG"
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
    printf '%s\n' "$output" | jq -e '.id == 9001 and .conclusion == "failure"' >/dev/null
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

@test "provider_pipelines_run_rerun PATCHes the build with retry=true" {
    printf '{"id":9001}' > "$TEST_TEMP_DIR/rerun.json"
    : > "$TEST_TEMP_DIR/rerun.body"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/rerun.json" STUB_CURL_REQUEST_BODY="$TEST_TEMP_DIR/rerun.body" \
        run azure_run provider_pipelines_run_rerun "" 9001
    [ "$status" -eq 0 ]
    grep -q 'builds/9001?retry=true' "$STUB_CALL_LOG"
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

@test "azure_build_root is the project's build API root, with the org and project of the spec, encoded" {
    azure_libs_source
    [ "$(azure_build_root "")" = "https://dev.azure.com/org/proj/_apis/build" ]
    [ "$(azure_build_root "o1/p1/r1")" = "https://dev.azure.com/o1/p1/_apis/build" ]
    [ "$(azure_build_root "my proj/r1")" = "https://dev.azure.com/org/my%20proj/_apis/build" ]
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

@test "run_list with a repo filters by the repository's GUID, joined to the query with '&'" {
    url="$(builds_url_for proj/repo1 --limit 7)"
    [[ "$url" == *'/_apis/build/builds?$top=7&queryOrder=queueTimeDescending&repositoryId=guid-1234&repositoryType=TfsGit'* ]]
}

@test "run_list URLs contain exactly one '?' before the api-version is appended" {
    for args in "--limit 3" "proj/repo1 --limit 3" "--branch main --limit 3" "proj/repo1 --branch main --status in_progress"; do
        # shellcheck disable=SC2086
        url="$(builds_url_for $args)"
        base="${url%%&api-version*}"
        [ "$(grep -o '?' <<<"$base" | wc -l)" -eq 1 ]
    done
}

# --workflow names a pipeline; the builds filter takes definition ids.
@test "run_list --workflow NAME looks the definition up and filters by its id" {
    printf '{"value":[{"id":42,"name":"CI"},{"id":43,"name":"CI-nightly"}]}' > "$TEST_TEMP_DIR/defs.json"
    build_page > "$TEST_TEMP_DIR/builds.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/defs.json" "$TEST_TEMP_DIR/builds.json" > "$TEST_TEMP_DIR/queue"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/queue" run azure_run provider_pipelines_run_list --workflow CI
    [ "$status" -eq 0 ]
    grep -q 'definitions?name=CI' "$STUB_CALL_LOG"
    grep -qE 'definitions=42(&| |$)' "$STUB_CALL_LOG"
    run ! grep -q 'definitions=43' "$STUB_CALL_LOG"
}

@test "run_list --workflow with a numeric id uses it directly" {
    build_page > "$TEST_TEMP_DIR/builds.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/builds.json" run azure_run provider_pipelines_run_list --workflow 42
    [ "$status" -eq 0 ]
    grep -qE 'definitions=42(&|$| )' "$STUB_CALL_LOG"
    run ! grep -q 'definitions?name' "$STUB_CALL_LOG"
}

@test "run_list --workflow with an unknown name fails and says so" {
    printf '{"value":[]}' > "$TEST_TEMP_DIR/none.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/none.json" run azure_run provider_pipelines_run_list --workflow nope
    [ "$status" -ne 0 ]
    [[ "$output" == *"no pipeline named 'nope'"* ]]
}

@test "run_list stops paging at --limit instead of reading the whole history" {
    local i; : > "$TEST_TEMP_DIR/queue"
    for i in 1 2 3 4 5; do
        printf '{"value":[{"id":%s,"status":"completed","result":"succeeded","sourceBranch":"refs/heads/m","definition":{"name":"CI"}}]}' "$i" > "$TEST_TEMP_DIR/b$i.json"
        printf '%s\n' "$TEST_TEMP_DIR/b$i.json" >> "$TEST_TEMP_DIR/queue"
    done
    STUB_CURL_PAGES="$TEST_TEMP_DIR/queue" run azure_run provider_pipelines_run_list --limit 2
    [ "$status" -eq 0 ]
    [ "$(jq 'length' <<< "$output")" -eq 2 ]
    [ "$(grep -c '^curl ' "$STUB_CALL_LOG")" -eq 2 ]
}

@test "run_download fetches each artifact through the transport's download helper" {
    printf '{"value":[{"name":"drop","resource":{"downloadUrl":"https://dev.azure.com/org/proj/_apis/build/builds/9/artifacts?artifactName=drop&%%24format=zip"}}]}' > "$TEST_TEMP_DIR/arts.json"
    printf 'PKzip' > "$TEST_TEMP_DIR/zip.bin"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/arts.json" "$TEST_TEMP_DIR/zip.bin" > "$TEST_TEMP_DIR/queue"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/queue" run azure_run provider_pipelines_run_download "" 9 -D "$TEST_TEMP_DIR/dl"
    [ "$status" -eq 0 ]
    [ "$(cat "$TEST_TEMP_DIR/dl/drop.zip")" = "PKzip" ]
}

@test "provider_pipelines_run_list maps the gh conclusions onto Azure's status and result filters" {
    build_page > "$TEST_TEMP_DIR/builds.json"
    local word expect_result
    for pair in "failure:failed" "success:succeeded" "cancelled:canceled"; do
        word="${pair%%:*}"; expect_result="${pair##*:}"
        : > "$STUB_CALL_LOG"
        STUB_CURL_RESPONSE="$TEST_TEMP_DIR/builds.json" \
            run azure_run provider_pipelines_run_list proj/repo1 --status "$word"
        [ "$status" -eq 0 ]
        grep -q 'statusFilter=completed' "$STUB_CALL_LOG"
        grep -q "resultFilter=${expect_result}" "$STUB_CALL_LOG"
    done
}

@test "provider_pipelines_run_list rejects a status word with no Azure analog" {
    build_page > "$TEST_TEMP_DIR/builds.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/builds.json" \
        run azure_run provider_pipelines_run_list proj/repo1 --status banana
    [ "$status" -ne 0 ]
    [[ "$output" == *"--status 'banana'"* || "$output" == *"status 'banana'"* ]]
}

@test "run_download fails when no artifact has the requested name" {
    printf '{"value":[{"name":"drop","resource":{"downloadUrl":"https://dev.azure.com/org/proj/_apis/build/builds/9/artifacts?artifactName=drop&%%24format=zip"}}]}' > "$TEST_TEMP_DIR/arts.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/arts.json" run azure_run provider_pipelines_run_download "" 9 -n missing -D "$TEST_TEMP_DIR/dl2"
    [ "$status" -ne 0 ]
    [[ "$output" == *"no artifact named 'missing'"* ]]
}

@test "run_download fails when the run has no artifacts at all" {
    printf '{"value":[]}' > "$TEST_TEMP_DIR/none.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/none.json" run azure_run provider_pipelines_run_download "" 9 -D "$TEST_TEMP_DIR/dl3"
    [ "$status" -ne 0 ]
    [[ "$output" == *"no artifacts"* ]]
}

@test "run_download never sends the PAT to a host outside Azure DevOps" {
    printf '{"value":[{"name":"drop","resource":{"downloadUrl":"https://evil.example.com/steal.zip"}}]}' > "$TEST_TEMP_DIR/evil.json"
    printf '%s\n' "$TEST_TEMP_DIR/evil.json" > "$TEST_TEMP_DIR/queue2"
    : > "$STUB_CALL_LOG"
    STUB_CURL_PAGES="$TEST_TEMP_DIR/queue2" run azure_run provider_pipelines_run_download "" 9 -D "$TEST_TEMP_DIR/dl4"
    [ "$status" -ne 0 ]
    run ! grep -q 'evil.example.com' "$STUB_CALL_LOG"
}

@test "azure_url_is_provider_host accepts only https on Azure DevOps hosts" {
    source "$DEVENV_TOOLS/lib/error-handling.bash"
    source "$DEVENV_TOOLS/lib/providers/azure/http.bash"
    azure_url_is_provider_host "https://dev.azure.com/o/p"
    azure_url_is_provider_host "https://vsblob.dev.azure.com/x"
    azure_url_is_provider_host "https://acme.visualstudio.com/p"
    run azure_url_is_provider_host "http://dev.azure.com/o/p"
    [ "$status" -ne 0 ]
    run azure_url_is_provider_host "https://dev.azure.com.evil.example/o"
    [ "$status" -ne 0 ]
    run azure_url_is_provider_host "https://evil.example/dev.azure.com/o"
    [ "$status" -ne 0 ]
    run azure_url_is_provider_host "https://dev.azure.com@evil.example/o"
    [ "$status" -ne 0 ]
}

@test "run_list rejects an unknown, malformed or trailing-comma --json field by name instead of returning []" {
    build_page > "$TEST_TEMP_DIR/builds.json"
    local bad
    for bad in "id,bogus" "id-x" "id," ",id"; do
        STUB_CURL_RESPONSE="$TEST_TEMP_DIR/builds.json" run azure_run provider_pipelines_run_list proj/repo1 --json "$bad"
        [ "$status" -ne 0 ] || { echo "accepted --json '$bad'"; false; }
        [[ "$output" == *"--json"* || "$output" == *"JSON field"* ]] || { echo "no named error for '$bad': $output"; false; }
    done
}

@test "run_view rejects an unknown --json field, and treats a null -q result as empty" {
    printf '{"id":9001,"status":"completed","result":"succeeded","sourceBranch":"refs/heads/m","definition":{"name":"ci"}}' > "$TEST_TEMP_DIR/b1.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/b1.json" run azure_run provider_pipelines_run_view proj/repo1 9001 --json id,bogus
    [ "$status" -ne 0 ]
    [[ "$output" == *"unknown JSON field 'bogus'"* ]]
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/b1.json" run azure_run provider_pipelines_run_view proj/repo1 9001 --json conclusion -q '.nothing'
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "the run fields the tools ask for are all accepted" {
    build_page > "$TEST_TEMP_DIR/builds.json"
    STUB_CURL_RESPONSE="$TEST_TEMP_DIR/builds.json" run azure_run provider_pipelines_run_list proj/repo1 --json workflowName,status,conclusion,headBranch,updatedAt,url,id
    [ "$status" -eq 0 ]
}
