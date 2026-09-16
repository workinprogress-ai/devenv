#!/usr/bin/env bats
# Guard tests for mongo-restore-server consent gate and error path
# (Plan-001 3.6).

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

assert_success() { [ "$status" -eq 0 ]; }
assert_failure() { [ "$status" -ne 0 ]; }

setup() {
    test_helper_setup
    stub_mongo
    export STUB_MONGORESTORE_LOG="$TEST_TEMP_DIR/restore.log"
    : > "$STUB_MONGORESTORE_LOG"
    # Backup tree: backup-20260901/db1, backup-20260910/db2 subdirs
    mkdir -p "$TEST_TEMP_DIR/backups/backup-20260901/db1"
    mkdir -p "$TEST_TEMP_DIR/backups/backup-20260910/db2"
    export DEVENV_TOOLS="$PROJECT_ROOT/tools"
}

@test "mongo-restore: refuses non-interactive run without --yes" {
    run bash "$DEVENV_TOOLS/scripts/mongo-restore-server.sh" "mongodb://user:pass@localhost:27017" "$TEST_TEMP_DIR/backups" < /dev/null
    [ "$status" -eq 2 ]
    [ ! -s "$STUB_MONGORESTORE_LOG" ]
}

@test "mongo-restore: --yes performs the restore with --drop" {
    run bash "$DEVENV_TOOLS/scripts/mongo-restore-server.sh" "mongodb://user:pass@localhost:27017" "$TEST_TEMP_DIR/backups" --yes < /dev/null
    assert_success
    grep -q -- "--drop" "$STUB_MONGORESTORE_LOG"
    grep -q -- "--uri=mongodb://user:pass@localhost:27017" "$STUB_MONGORESTORE_LOG"
}

@test "mongo-restore: YES=1 env var is accepted as consent" {
    export YES=1
    run bash "$DEVENV_TOOLS/scripts/mongo-restore-server.sh" "mongodb://localhost:27017" "$TEST_TEMP_DIR/backups" < /dev/null
    assert_success
    grep -q -- "--drop" "$STUB_MONGORESTORE_LOG"
}

@test "mongo-restore: picks the latest backup directory" {
    export YES=1
    run bash "$DEVENV_TOOLS/scripts/mongo-restore-server.sh" "mongodb://localhost:27017" "$TEST_TEMP_DIR/backups" --yes < /dev/null
    assert_success
    grep -q "backup-20260910" "$STUB_MONGORESTORE_LOG"
}

@test "mongo-restore: displays redacted credentials, restores with real ones" {
    export YES=1
    run bash "$DEVENV_TOOLS/scripts/mongo-restore-server.sh" "mongodb://user:secret@localhost:27017" "$TEST_TEMP_DIR/backups" --yes < /dev/null
    assert_success
    [[ "$output" == *"***@localhost:27017"* ]]
    [[ "$output" != *"secret"* ]]
    grep -q -- "--uri=mongodb://user:secret@localhost:27017" "$STUB_MONGORESTORE_LOG"
}

@test "mongo-restore: failure path is reachable and reports non-zero" {
    export STUB_MONGORESTORE_FAIL=1
    run bash "$DEVENV_TOOLS/scripts/mongo-restore-server.sh" "mongodb://localhost:27017" "$TEST_TEMP_DIR/backups" --yes < /dev/null
    assert_failure
    [[ "$output" == *"Restore failed"* ]]
}

@test "mongo-restore: missing backup directory fails with 4" {
    run bash "$DEVENV_TOOLS/scripts/mongo-restore-server.sh" "mongodb://localhost:27017" "$TEST_TEMP_DIR/nope" --yes < /dev/null
    [ "$status" -eq 4 ]
}

@test "mongo-restore: unknown option exits 2" {
    run bash "$DEVENV_TOOLS/scripts/mongo-restore-server.sh" "mongodb://localhost:27017" "$TEST_TEMP_DIR/backups" --frobnicate < /dev/null
    [ "$status" -eq 2 ]
}

@test "mongo-restore: missing args show usage and exit 2" {
    run bash "$DEVENV_TOOLS/scripts/mongo-restore-server.sh" < /dev/null
    [ "$status" -eq 2 ]
    [[ "$output" == *"Usage:"* ]]
}
