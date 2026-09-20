#!/usr/bin/env bats
# Smoke tests for the shared CLI stub fixtures.
# Verifies each stub emits its canned output, honors its mode flags, and
# records invocations — so guard-test failures point at guard bugs,
# not fixture bugs.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

assert_success() {
    [ "$status" -eq 0 ]
}

assert_failure() {
    [ "$status" -ne 0 ]
}

setup() {
    test_helper_setup
    # Direct (non-run) stub invocations still need the env the stubs read.
    export STUB_CALL_LOG
    export TEST_TEMP_DIR
}

@test "fixtures: kubectl stub lists pods in plain and json modes" {
    stub_kubectl_json
    export STUB_KUBECTL_PODS=$'web-1\nweb-2'
    run kubectl get pods -o json
    [[ "$output" == *'"web-1"'* ]]
    [[ "$output" == *'"web-2"'* ]]
    run kubectl get pods
    [[ "$output" == *"web-1"* ]]
}

@test "fixtures: kubectl stub records delete and scale targets" {
    stub_kubectl_json
    export STUB_KUBECTL_DELETED="$TEST_TEMP_DIR/deleted.txt"
    export STUB_KUBECTL_SCALED="$TEST_TEMP_DIR/scaled.txt"
    run kubectl delete pod web-1 -n prod
    assert_success
    run kubectl scale deployment web --replicas=3 -n prod
    assert_success
    grep -qx "web-1" "$STUB_KUBECTL_DELETED"
    grep -qx "web" "$STUB_KUBECTL_SCALED"
}
@test "fixtures: kubectl failure mode propagates" {
    stub_kubectl
    STUB_KUBECTL_FAIL=1 run kubectl get pods
    assert_failure
}

@test "fixtures: gh stub serves canned API response and records mutations" {
    stub_gh
    printf '[{"id": 1, "body": "doc_id: x"}]' > "$TEST_TEMP_DIR/api.json"
    export STUB_GH_API_RESPONSE="$TEST_TEMP_DIR/api.json"
    export STUB_GH_MUTATIONS="$TEST_TEMP_DIR/mutations.log"
    run gh api repos/o/r/issues/1/comments
    assert_success
    [[ "$output" == *"doc_id: x"* ]]
    run gh api repos/o/r/issues/comments/1 -X PATCH -f body=updated
    assert_success
    grep -q "PATCH" "$STUB_GH_MUTATIONS"
}

@test "fixtures: gh failure mode propagates" {
    stub_gh
    STUB_GH_FAIL=1 run gh api repos/o/r/issues/1/comments
    assert_failure
}

@test "fixtures: mongo stubs list databases and honor failure modes" {
    stub_mongo
    export STUB_MONGOSH_DATABASES=$'db1\ndb2'
    run mongosh "mongodb://x" --quiet --eval "list"
    assert_success
    [[ "$output" == *"db1"* ]]
    STUB_MONGOSH_FAIL=1 run mongosh "mongodb://x" --quiet --eval "list"
    assert_failure
    export STUB_MONGORESTORE_LOG="$TEST_TEMP_DIR/restore.log"
    run mongorestore --uri="mongodb://x" --drop /backup
    assert_success
    grep -q -- "--drop" "$STUB_MONGORESTORE_LOG"
    STUB_MONGORESTORE_FAIL=1 run mongorestore --uri="mongodb://x" /backup
    assert_failure
}

@test "fixtures: git stub replays scenario script" {
    stub_git
    cat > "$TEST_TEMP_DIR/git-scenario.sh" << 'EOF'
case "$1" in
    log) printf 'def567 fix: real work\nabc1234 WIP: temp\n' ;;
    merge-base) exit 0 ;;
    *) exit 0 ;;
esac
EOF
    export STUB_GIT_SCRIPT="$TEST_TEMP_DIR/git-scenario.sh"
    run git log --oneline
    [[ "$output" == *"def567"* ]]
}

@test "fixtures: call log records every invocation and counts per command" {
    stub_kubectl_json
    run kubectl get pods
    run kubectl get pods
    [ "$(stub_call_count kubectl)" -eq 2 ]
    stub_calls_contain "kubectl get pods"
}

@test "fixtures: mongodump stub records argv and honors failure mode" {
    stub_mongo
    export STUB_MONGODUMP_LOG="$TEST_TEMP_DIR/dump.log"
    run mongodump --uri="mongodb://x" --db db1 --out /backup
    assert_success
    grep -q -- "--db db1" "$STUB_MONGODUMP_LOG"
    STUB_MONGODUMP_FAIL=1 run mongodump --uri="mongodb://x" --db db2
    assert_failure
}

@test "fixtures: gh paginated mode serves queued pages in order" {
    stub_gh
    printf '{"page":1}' > "$TEST_TEMP_DIR/p1.json"
    printf '{"page":2}' > "$TEST_TEMP_DIR/p2.json"
    printf '%s\n%s\n' "$TEST_TEMP_DIR/p1.json" "$TEST_TEMP_DIR/p2.json" > "$TEST_TEMP_DIR/pages.txt"
    export STUB_GH_PAGES="$TEST_TEMP_DIR/pages.txt"
    run gh api repos/o/r/threads/1
    [[ "$output" == *'"page":1'* ]]
    run gh api repos/o/r/threads/1
    [[ "$output" == *'"page":2'* ]]
    # Queue exhausted -> stub fails
    run gh api repos/o/r/threads/1
    assert_failure
    # Two successful GETs were recorded
    [ "$(stub_call_count gh)" -eq 3 ]
}
