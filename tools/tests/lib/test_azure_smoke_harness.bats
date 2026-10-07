#!/usr/bin/env bats
# The Azure live-validation harness (tools/lib/providers/azure/azure-smoke-test.sh)
# is manual-only against a LIVE org. These tests drive it against a fake curl and a
# fake git push, so its OWN behavior — the safety gate, teardown, and the honesty of
# its probes — is verified without any network.

bats_require_minimum_version 1.5.0

load ../test_helper

HARNESS="$BATS_TEST_DIRNAME/../../lib/providers/azure/azure-smoke-test.sh"

setup() {
    test_helper_setup
    export CURL_LOG="$TEST_TEMP_DIR/curl.log"; : > "$CURL_LOG"
    export GIT_PUSH_LOG="$TEST_TEMP_DIR/push.log"; : > "$GIT_PUSH_LOG"
    export PID_FILE="$TEST_TEMP_DIR/harness.pid"
    export REAL_GIT; REAL_GIT="$(command -v git)"
    mkdir -p "$TEST_TEMP_DIR/bin"

    # Fake curl: logs "METHOD URL", writes an HTTP status line to the -D file and a
    # canned JSON body to stdout. FAKE_CURL_TERM_ON=<regex> kills the harness (TERM)
    # when a request matches, to simulate an interrupted run.
    cat > "$TEST_TEMP_DIR/bin/curl" <<'STUB'
#!/usr/bin/env bash
method=GET; hdr=""; url=""
while [ $# -gt 0 ]; do
    case "$1" in
        -X) method="$2"; shift 2 ;;
        -D) hdr="$2"; shift 2 ;;
        -H|--max-time|-d) shift 2 ;;
        -*) shift ;;
        *) url="$1"; shift ;;
    esac
done
echo "$method $url" >> "$CURL_LOG"
if [ -n "${FAKE_CURL_TERM_ON:-}" ] && [[ "$method $url" =~ $FAKE_CURL_TERM_ON ]]; then
    kill -TERM "$(cat "$PID_FILE")"
    sleep 1
fi
body='{}'
[ -n "${FAKE_BOARD_COLUMNS:-}" ] || FAKE_BOARD_COLUMNS='{"value":[{"name":"New"},{"name":"Active"},{"name":"Closed"}]}'
[ -n "${FAKE_PR_BODY:-}" ] || FAKE_PR_BODY='{"pullRequestId":7,"status":"completed","completionOptions":{"mergeStrategy":"rebase"},"lastMergeSourceCommit":{"commitId":"abc"}}'
[ -n "${FAKE_REFS:-}" ] || FAKE_REFS='{"count":0,"value":[]}'
[ -n "${FAKE_COMMIT:-}" ] || FAKE_COMMIT='{"commitId":"c1","parents":["p1"]}'
case "$method $url" in
    "POST "*"/pullrequests"*)
        if [ -n "${FAKE_PR:-}" ]; then
            body='{"pullRequestId":7,"status":"active","repository":{"webUrl":"https://dev.azure.com/fake-org/smoke-proj/_git/smoke-repo"}}'
        else
            body='{"id":"g2","name":"smoke-repo"}'
        fi ;;
    "GET "*"/pullrequests/7"*) body="$FAKE_PR_BODY" ;;
    "GET "*"/refs"*) body="$FAKE_REFS" ;;
    "GET "*"/commits/c1"*) body="$FAKE_COMMIT" ;;
    "GET "*"/commits?"*) body='{"value":[{"commitId":"c1"}]}' ;;
    "GET "*"/_apis/projects?"*|"GET "*"/_apis/projects") body='{"value":[{"name":"smoke-proj","id":"p1"}]}' ;;
    "GET "*"/_apis/projects/smoke-proj"*) body='{"id":"p1","name":"smoke-proj"}' ;;
    "GET "*"feeds.dev.azure.com"*) body='{"value":[]}' ;;
    "GET "*"/_apis/policy/configurations"*) body='{"value":[]}' ;;
    "POST "*"/workitems/"*"/comments"*) body='{"id":5,"workItemId":101,"text":"c"}' ;;
    "POST "*"/workitems/"*) body='{"id":101}' ;;
    "POST "*"/wiql"*) body='{"workItems":[{"id":1}]}' ;;
    "GET "*"/git/repositories/"*"?"*) body='{"id":"g1","name":"existing-repo","defaultBranch":"refs/heads/main","project":{"name":"smoke-proj"}}' ;;
    "GET "*"/git/repositories?"*|"GET "*"/git/repositories") body='{"value":[{"id":"g1","name":"existing-repo","url":"https://dev.azure.com/fake-org/smoke-proj/_apis/git/repositories/g1"}],"count":1}' ;;
    "GET "*"/_apis/projects/"*"/teams"*) body='{"value":[{"id":"t1","name":"smoke-proj Team"}]}' ;;
    "GET "*"/_apis/work/boards/"*"/columns"*) body="$FAKE_BOARD_COLUMNS" ;;
    "GET "*"/_apis/work/boards"*) body='{"value":[{"id":"b1","name":"Issues"}]}' ;;
    "GET "*"/workitems/"[0-9]*)
        if [ -n "${FAKE_NO_WEF:-}" ]; then
            body='{"id":101,"fields":{"System.State":"New","System.Tags":"alpha;beta","System.Title":"t"}}'
        else
            body='{"id":101,"fields":{"System.State":"New","System.Tags":"alpha;beta","System.Title":"t","WEF_abc123_Kanban.Column":"New"}}'
        fi ;;
    "POST "*"/git/repositories"*) body='{"id":"g2","name":"smoke-repo"}' ;;
    "GET "*"/workitemtypes/"*"/states"*) body='{"value":[{"name":"New","category":"Proposed"},{"name":"Active","category":"InProgress"},{"name":"Closed","category":"Completed"}]}' ;;
    "GET "*"/_apis/projects/p1?"*) body='{"id":"p1","capabilities":{"processTemplate":{"templateName":"Agile"}}}' ;;
esac
printf 'HTTP/1.1 200 OK\r\n\r\n' > "$hdr"
printf '%s' "$body"
STUB
    # Fake git: a push is logged and succeeds (or fails when FAKE_GIT_PUSH_FAIL is
    # set); everything else is the real git, so local init/commit/checkout work.
    cat > "$TEST_TEMP_DIR/bin/git" <<'STUB'
#!/usr/bin/env bash
if [[ " $* " == *" push "* ]]; then
    echo "push $*" >> "$GIT_PUSH_LOG"
    [ -n "${FAKE_GIT_PUSH_FAIL:-}" ] && { echo "fatal: simulated push failure" >&2; exit 1; }
    exit 0
fi
exec "$REAL_GIT" "$@"
STUB
    chmod +x "$TEST_TEMP_DIR/bin/curl" "$TEST_TEMP_DIR/bin/git"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    export AZURE_PAT="fake-pat-value" AZURE_DEVOPS_ORG="fake-org" AZURE_SMOKE_TEST_PROJECT="smoke-proj"
    export AZURE_API_VERSION="7.1" AZURE_HTTP_MAX_RETRIES=1 AZURE_SMOKE_POLL_INTERVAL=0 AZURE_SMOKE_POLL_MAX=2
    unset AZURE_SMOKE AZURE_SMOKE_CONFIRM
}

teardown() {
    test_helper_teardown
}

# run_harness: runs the harness with a stable PID (exec) so the fake curl can signal it.
run_harness() {
    bash -c 'echo $$ > "$PID_FILE"; exec bash "$0" "$@"' "$HARNESS" "$@" </dev/null
}

@test "azure-smoke-test.sh has valid bash syntax" {
    run bash -n "$HARNESS"
    [ "$status" -eq 0 ]
}

@test "--help works without the gate" {
    run run_harness --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"AZURE_SMOKE"* ]]
}

@test "gate: refuses to run at all without AZURE_SMOKE (no request is made)" {
    run run_harness
    [ "$status" -ne 0 ]
    [[ "$output" == *"AZURE_SMOKE"* ]]
    [ ! -s "$CURL_LOG" ]
}

@test "gate: any value other than 1 or write is refused" {
    AZURE_SMOKE=yes run run_harness
    [ "$status" -ne 0 ]
    [ ! -s "$CURL_LOG" ]
}

@test "gate: AZURE_SMOKE=1 is the read-only tier — it issues no writes and creates no fixtures" {
    AZURE_SMOKE=1 run run_harness
    # the project-existence and reads run; nothing is created, patched or deleted
    [ -s "$CURL_LOG" ]
    run grep -E '^(PATCH|PUT|DELETE) ' "$CURL_LOG"
    [ "$status" -ne 0 ]
    run grep -E '^POST .*(/workitems/|/git/repositories|/pullrequests|/policy/)' "$CURL_LOG"
    [ "$status" -ne 0 ]
}

@test "gate: AZURE_SMOKE=write without an explicit confirmation is refused before any request" {
    AZURE_SMOKE=write run run_harness
    [ "$status" -ne 0 ]
    [[ "$output" == *"AZURE_SMOKE_CONFIRM"* ]]
    [ ! -s "$CURL_LOG" ]
}

@test "gate: a confirmation naming a different project is refused" {
    AZURE_SMOKE=write AZURE_SMOKE_CONFIRM=some-other-project run run_harness
    [ "$status" -ne 0 ]
    [ ! -s "$CURL_LOG" ]
}

@test "gate: AZURE_SMOKE=write with the matching confirmation runs the destructive tier" {
    AZURE_SMOKE=write AZURE_SMOKE_CONFIRM=smoke-proj run run_harness
    grep -q '^POST .*/workitems/' "$CURL_LOG"
}

# ---------------------------------------------------------------------------
# Teardown: mandatory, trapped, and complete
# ---------------------------------------------------------------------------

write_run() {   # a full destructive-tier run against the fakes
    AZURE_SMOKE=write AZURE_SMOKE_CONFIRM=smoke-proj run_harness "$@"
}

@test "teardown: an interrupt (TERM) mid-run still deletes the repo and the work items" {
    export FAKE_CURL_TERM_ON='POST .*/pullrequests'
    run write_run
    # after the TERM the teardown stack must have issued the deletes
    run bash -c "awk '/POST .*\/pullrequests/{seen=1} seen && /^DELETE /' '$CURL_LOG'"
    [[ "$output" == *"/git/repositories/smoke-repo-"* ]]
    [[ "$output" == *"/workitems/"* ]]
}

@test "teardown: every work item the run created is destroyed" {
    run write_run
    posts="$(grep -cE '^POST .*/workitems/\$' "$CURL_LOG")"
    dels="$(grep -cE '^DELETE .*/workitems/[0-9]+\?destroy=true' "$CURL_LOG")"
    [ "$posts" -ge 1 ]
    [ "$dels" -ge "$posts" ]
}

@test "teardown: the repo-scoped policy sweep runs before the repo is deleted (LIFO)" {
    run write_run
    sweep_line="$(grep -nE '^GET .*policy/configurations' "$CURL_LOG" | tail -1 | cut -d: -f1)"
    repo_del_line="$(grep -nE '^DELETE .*/git/repositories/smoke-repo-' "$CURL_LOG" | head -1 | cut -d: -f1)"
    [ -n "$sweep_line" ] && [ -n "$repo_del_line" ]
    [ "$sweep_line" -lt "$repo_del_line" ]
}

@test "teardown: the run leaves no temp files behind (clone, askpass helper, payloads)" {
    export TMPDIR="$TEST_TEMP_DIR/tmpdir"; mkdir -p "$TMPDIR"
    run write_run
    [ -z "$(ls -A "$TMPDIR")" ] || { ls -A "$TMPDIR"; false; }
}

@test "teardown: the read-only tier also leaves no temp files" {
    export TMPDIR="$TEST_TEMP_DIR/tmpdir"; mkdir -p "$TMPDIR"
    AZURE_SMOKE=1 run run_harness
    [ -z "$(ls -A "$TMPDIR")" ] || { ls -A "$TMPDIR"; false; }
}

# ---------------------------------------------------------------------------
# Honesty: a probe passes only when the thing it names actually happened
# ---------------------------------------------------------------------------

@test "honesty: a failed seed/branch push is reported FAIL, never PASS, and no PR is attempted" {
    export FAKE_GIT_PUSH_FAIL=1
    run write_run
    [[ "$output" == *"FAIL  default branch seed"* ]]
    [[ "$output" != *"PASS  branch push"* ]]
    run grep -E '^POST .*/pullrequests' "$CURL_LOG"
    [ "$status" -ne 0 ]
}

@test "honesty: with working pushes the branch-push probe passes and a PR is attempted" {
    run write_run
    [[ "$output" == *"PASS  branch push"* ]]
    grep -qE '^POST .*/pullrequests' "$CURL_LOG"
}

@test "honesty: PR create passes only when a PR id was actually parsed" {
    # the fake returns no pullrequest URL, so no id can be parsed
    run write_run
    [[ "$output" != *"PASS  PR create (id )"* ]]
    [[ "$output" == *"FAIL  PR create"* ]]
}

@test "honesty: the seed push really targets the configured origin remote" {
    run write_run
    grep -q 'push -q origin main' "$GIT_PUSH_LOG"
}

# ---------------------------------------------------------------------------
# set -u: a typo'd variable must die loudly, not fabricate empty URLs
# ---------------------------------------------------------------------------

@test "the harness runs under set -u" {
    grep -qE '^set -u$' "$HARNESS"
}

@test "a full destructive run hits no unbound variable" {
    run write_run
    [[ "$output" != *"unbound variable"* ]]
}

@test "no request URL is built from an empty project or org (no double slashes in the path)" {
    run write_run
    run grep -E '^[A-Z]+ https://dev\.azure\.com/[^/]*//' "$CURL_LOG"
    [ "$status" -ne 0 ]
    run grep -E '^[A-Z]+ https://dev\.azure\.com//' "$CURL_LOG"
    [ "$status" -ne 0 ]
}

@test "the field_option_ids probe reads the verb's newline-delimited stream" {
    run write_run
    [[ "$output" == *"PASS  provider_projects_field_option_ids"* ]]
}

# ---------------------------------------------------------------------------
# Capture: live responses can be recorded as redacted fixtures
# ---------------------------------------------------------------------------

@test "capture: --help documents AZURE_SMOKE_CAPTURE_DIR" {
    run run_harness --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"AZURE_SMOKE_CAPTURE_DIR"* ]]
}

@test "capture: a run with capture enabled leaves no redaction map behind" {
    export TMPDIR="$TEST_TEMP_DIR/tmpdir"; mkdir -p "$TMPDIR"
    export AZURE_SMOKE_CAPTURE_DIR="$TEST_TEMP_DIR/captures"
    AZURE_SMOKE=1 run run_harness
    [ -z "$(ls -A "$TMPDIR")" ] || { ls -A "$TMPDIR"; false; }
}

@test "capture: without AZURE_SMOKE_CAPTURE_DIR no capture directory or map is created" {
    export TMPDIR="$TEST_TEMP_DIR/tmpdir"; mkdir -p "$TMPDIR"
    AZURE_SMOKE=1 run run_harness
    [ ! -e "$TEST_TEMP_DIR/captures" ]
    [ -z "$(ls -A "$TMPDIR")" ]
}

@test "capture: the redaction map is never created inside the capture directory" {
    export AZURE_SMOKE_CAPTURE_DIR="$TEST_TEMP_DIR/captures"
    AZURE_SMOKE=1 run run_harness
    ! find "$AZURE_SMOKE_CAPTURE_DIR" -name 'smoke-redact-map*' 2>/dev/null | grep -q .
}

# ---------------------------------------------------------------------------
# Tier 1 outcome checks: assert what the service returned, not just rc 0
# ---------------------------------------------------------------------------

@test "tier 1: board columns equal to status_workflow pass" {
    AZURE_SMOKE_STATUS_WORKFLOW="New,Active,Closed" AZURE_SMOKE=1 run run_harness
    [[ "$output" == *"PASS  board 'Issues' columns equal status_workflow"* ]]
}

@test "tier 1: board columns that differ from status_workflow FAIL" {
    AZURE_SMOKE_STATUS_WORKFLOW="New,Active,Review,Closed" AZURE_SMOKE=1 run run_harness
    [[ "$output" == *"FAIL  board 'Issues' columns equal status_workflow"* ]]
}

@test "tier 1: the configured status_workflow is used when no override is set" {
    # the test config defines an 8-word vocabulary; the fake board has 3 columns
    AZURE_SMOKE=1 run run_harness
    [[ "$output" == *"FAIL  board 'Issues' columns equal status_workflow"* ]]
}

@test "tier 1: without a status_workflow the board check is skipped, not failed" {
    sed -i '/^\[workflows\]/,$d' "$DEVENV_ROOT/devenv.config"
    AZURE_SMOKE=1 run run_harness
    [[ "$output" == *"SKIP  board columns vs status_workflow"* ]]
    [[ "$output" != *"FAIL  board 'Issues' columns"* ]]
}

@test "tier 1: labels that equal the raw trimmed tags pass" {
    AZURE_SMOKE=1 run run_harness
    [[ "$output" == *"PASS  work item raw shape"* ]]
}

@test "tier 1: PR list state checks are skipped when the repo has no pull requests" {
    AZURE_SMOKE=1 run run_harness
    [[ "$output" == *"SKIP  PR list state filters"* ]]
}

@test "tier 1: captured fixtures exist and carry no real org or project name" {
    export AZURE_SMOKE_CAPTURE_DIR="$TEST_TEMP_DIR/captures"
    AZURE_SMOKE_STATUS_WORKFLOW="New,Active,Closed" AZURE_SMOKE=1 run run_harness
    for f in repos.list.json wiql.query.json workitem.get.json boards.list.json board.columns.Issues.json workitemtypes.issue.states.json; do
        [ -f "$AZURE_SMOKE_CAPTURE_DIR/$f" ] || { echo "missing fixture: $f"; ls "$AZURE_SMOKE_CAPTURE_DIR"; false; }
        jq -e . "$AZURE_SMOKE_CAPTURE_DIR/$f" >/dev/null
    done
    run ! grep -rqiE 'fake-org|smoke-proj|fake-pat-value' "$AZURE_SMOKE_CAPTURE_DIR"
    grep -q 'example-org' "$AZURE_SMOKE_CAPTURE_DIR/repos.list.json"
}

@test "tier 1: the read-only tier with capture enabled still issues no writes" {
    export AZURE_SMOKE_CAPTURE_DIR="$TEST_TEMP_DIR/captures"
    AZURE_SMOKE=1 run run_harness
    run grep -E '^(PATCH|PUT|DELETE) ' "$CURL_LOG"
    [ "$status" -ne 0 ]
}

# ---------------------------------------------------------------------------
# Tier 2 outcome checks
# ---------------------------------------------------------------------------

@test "tier 2: a completed PR, a deleted source branch and a one-parent head pass the merge outcome checks" {
    export FAKE_PR=1
    run write_run
    [[ "$output" == *"PASS  merged PR is completed"* ]]
    [[ "$output" == *"PASS  source branch is deleted after the merge"* ]]
    [[ "$output" == *"PASS  rebase merge leaves a linear history"* ]]
}

@test "tier 2: a merge that leaves the source branch behind FAILs the outcome check" {
    export FAKE_PR=1 FAKE_REFS='{"count":1,"value":[{"name":"refs/heads/smoke-1"}]}'
    run write_run
    [[ "$output" == *"FAIL  source branch is deleted after the merge"* ]]
}

@test "tier 2: a merge commit (two parents) FAILs the linear-history check" {
    export FAKE_PR=1 FAKE_COMMIT='{"commitId":"c1","parents":["p1","p2"]}'
    run write_run
    [[ "$output" == *"FAIL  rebase merge leaves a linear history"* ]]
}

@test "tier 2: a status that reads back as itself passes, one that does not FAILs" {
    AZURE_SMOKE_STATUS_WORKFLOW="New,Review" run write_run
    [[ "$output" == *"PASS  status round-trip [Issue]: 'New' reads back as itself"* ]]
    [[ "$output" == *"FAIL  status round-trip [Issue]: 'Review' reads back as itself"* ]]
}

@test "tier 2: the Kanban column write is read back and compared" {
    AZURE_SMOKE_STATUS_WORKFLOW="New,Review" run write_run
    [[ "$output" == *"PASS  Kanban column write [Issue]: 'New' reads back"* ]]
    [[ "$output" == *"FAIL  Kanban column write [Issue]: 'Review' reads back"* ]]
}

@test "tier 2: without a status_workflow the round-trip is skipped" {
    sed -i '/^\[workflows\]/,$d' "$DEVENV_ROOT/devenv.config"
    run write_run
    [[ "$output" == *"SKIP  status round-trip"* ]]
}

@test "tier 2: tag edit outcomes are asserted against the work item's real tags" {
    # the fake work item always carries alpha;beta, so the two-tag outcome must FAIL
    run write_run
    [[ "$output" == *"FAIL  two label adds leave two tags"* ]]
    [[ "$output" == *"FAIL  edit --add-label keeps the existing tags"* ]]
}

@test "tier 2: the review-PR experiment pushes both branches, deletes both, and records the PR state" {
    export FAKE_PR=1
    run write_run
    [[ "$output" == *"review PR after both branches are deleted (evidence) — status=completed"* ]]
    grep -q ':review/smoke-.*-target' "$GIT_PUSH_LOG"
    grep -q ':review/smoke-.*-source' "$GIT_PUSH_LOG"
}

@test "tier 2: the review-PR experiment does not run when the seed push failed" {
    export FAKE_GIT_PUSH_FAIL=1 FAKE_PR=1
    run write_run
    [[ "$output" != *"review PR after both branches"* ]]
}

@test "a full destructive run reaches its summary line (it does not die mid-run)" {
    run write_run
    [[ "$output" == *"summary:"* ]]
}

@test "a full destructive run still exercises the probes that follow the projects probes" {
    run write_run
    [[ "$output" == *"provider_prs_threads_page"* ]] || [[ "$output" == *"second PR create"* ]]
    [[ "$output" == *"provider_repos_patch"* ]]
}

@test "tier 2: a work item type with no board Kanban column field is reported as a FAIL, not skipped" {
    export FAKE_NO_WEF=1
    run write_run
    [[ "$output" == *"FAIL  work item type [Issue] carries a board Kanban column field"* ]]
    [[ "$output" == *"summary:"* ]]
}

@test "tier 2: a User Story fixture is created, status-checked and destroyed" {
    run write_run
    [[ "$output" == *"PASS  fixture User Story"* ]]
    [[ "$output" == *"[User Story]"* ]]
    run grep -E '^DELETE .*/workitems/[0-9]+\?destroy=true' "$CURL_LOG"
    [ "$status" -eq 0 ]
}

@test "tier 1: the project process template is checked and recorded" {
    export AZURE_SMOKE_CAPTURE_DIR="$TEST_TEMP_DIR/captures"
    AZURE_SMOKE=1 run run_harness
    [[ "$output" == *"PASS  project process is Agile"* ]]
    [ -f "$AZURE_SMOKE_CAPTURE_DIR/project.capabilities.json" ]
    [ -f "$AZURE_SMOKE_CAPTURE_DIR/workitemtypes.user-story.states.json" ]
}

@test "tier 2: a PR completed with another strategy than rebase FAILs the strategy check" {
    export FAKE_PR=1 FAKE_PR_BODY='{"pullRequestId":7,"status":"completed","completionOptions":{"mergeStrategy":"noFastForward"},"lastMergeSourceCommit":{"commitId":"abc"}}'
    run write_run
    [[ "$output" == *"FAIL  merge used the rebase strategy"* ]]
}

@test "tier 2: a PR that never completes is judged after polling, not hung on" {
    export FAKE_PR=1 FAKE_PR_BODY='{"pullRequestId":7,"status":"active","mergeStatus":"queued","lastMergeSourceCommit":{"commitId":"abc"}}'
    run write_run
    [[ "$output" == *"FAIL  merged PR is completed"* ]]
    [[ "$output" == *"summary:"* ]]
}
