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
case "$method $url" in
    "GET "*"/_apis/projects?"*|"GET "*"/_apis/projects") body='{"value":[{"name":"smoke-proj","id":"p1"}]}' ;;
    "POST "*"/workitems/"*"/comments"*) body='{"id":5,"workItemId":101,"text":"c"}' ;;
    "POST "*"/workitems/"*) body='{"id":101}' ;;
    "POST "*"/wiql"*) body='{"workItems":[{"id":1}]}' ;;
    "GET "*"/git/repositories?"*|"GET "*"/git/repositories") body='{"value":[{"id":"g1","name":"existing-repo"}],"count":1}' ;;
    "POST "*"/git/repositories"*) body='{"id":"g2","name":"smoke-repo"}' ;;
    "GET "*"/workitemtypes/Issue/states"*) body='{"value":[{"name":"New"},{"name":"Active"},{"name":"Closed"}]}' ;;
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
    export AZURE_API_VERSION="7.1" AZURE_HTTP_MAX_RETRIES=1
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
