#!/usr/bin/env bats
# Behavior tests for mongo-backup-server: the guarded database-listing path.
#
# Locks: a mongosh failure aborts before any dump; a malformed name in the
# listing aborts before any dump; a valid listing dumps each non-built-in
# database exactly once; a mongodump failure surfaces non-zero.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

setup() {
    test_helper_setup
    stub_mongo
    export STUB_MONGODUMP_LOG="$TEST_TEMP_DIR/dump.log"
    : > "$STUB_MONGODUMP_LOG"
    export DEVENV_TOOLS="$PROJECT_ROOT/tools"
    export BACKUP_DIR="$TEST_TEMP_DIR/backups"
    mkdir -p "$BACKUP_DIR"
}

@test "backup: valid DB list dumps each non-built-in database once" {
    export STUB_MONGOSH_DATABASES=$'admin\nappdb\nauditdb\nconfig\nlocal'
    run bash "$DEVENV_TOOLS/scripts/mongo-backup-server.sh" "mongodb://user:pass@localhost:27017" "$BACKUP_DIR" < /dev/null
    [ "$status" -eq 0 ]
    [ "$(grep -c -- '--db appdb' "$STUB_MONGODUMP_LOG")" -eq 1 ]
    [ "$(grep -c -- '--db auditdb' "$STUB_MONGODUMP_LOG")" -eq 1 ]
    # Built-ins were never dumped
    ! grep -q -- '--db admin' "$STUB_MONGODUMP_LOG"
    ! grep -q -- '--db local' "$STUB_MONGODUMP_LOG"
    [[ "$output" == *"Backup completed"* ]]
}

@test "backup: garbage database name aborts before any mongodump" {
    export STUB_MONGOSH_DATABASES=$'gooddb\nWARNING: auth failed\ngooddb2'
    run bash "$DEVENV_TOOLS/scripts/mongo-backup-server.sh" "mongodb://localhost:27017" "$BACKUP_DIR" < /dev/null
    [ "$status" -ne 0 ]
    [[ "$output" == *"invalid database name"* ]]
    [[ "$output" == *"WARNING: auth failed"* ]]
    [ ! -s "$STUB_MONGODUMP_LOG" ]
}

@test "backup: mongosh failure aborts with API-failure exit" {
    export STUB_MONGOSH_FAIL=1
    run bash "$DEVENV_TOOLS/scripts/mongo-backup-server.sh" "mongodb://localhost:27017" "$BACKUP_DIR" < /dev/null
    [ "$status" -eq 4 ]
    [ ! -s "$STUB_MONGODUMP_LOG" ]
}

@test "backup: mongodump failure is reported non-zero" {
    export STUB_MONGOSH_DATABASES=$'crashdb'
    export STUB_MONGODUMP_FAIL=1
    run bash "$DEVENV_TOOLS/scripts/mongo-backup-server.sh" "mongodb://localhost:27017" "$BACKUP_DIR" < /dev/null
    [ "$status" -ne 0 ]
    [[ "$output" == *"Backup failed for database: crashdb"* ]]
}
