#!/usr/bin/env bats
# Tests for lib/providers/azure/fork-sync.sh — on-demand upstream sync.
#
# Contract tests for on-demand upstream sync.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    SCRIPT="$DEVENV_TOOLS/lib/providers/azure/fork-sync.sh"
}

teardown() {
    test_helper_teardown
}

_setup_sync_fixture() {
    create_fork_fixture_trio "$TEST_TEMP_DIR/fork-fixture"
    git -C "$FORK_FIXTURE_WORKING_CLONE" remote add upstream "$FORK_FIXTURE_UPSTREAM"
    export DEVENV_ROOT="$TEST_TEMP_DIR/config-root"
    export DEVENV_ROOT_SET=1
    mkdir -p "$DEVENV_ROOT"
    printf '[fork]\nupstream_repo=%s\nupstream_branch=master\n' "$FORK_FIXTURE_UPSTREAM" > "$DEVENV_ROOT/devenv.config"
    cd "$FORK_FIXTURE_WORKING_CLONE"
}

@test "fork-sync: script has valid syntax" {
    bash -n "$SCRIPT"
}

@test "fork-sync: --help documents the sync contract" {
    run bash "$SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"fork-sync.sh"* ]]
    [[ "$output" == *"ahead/behind"* ]]
    [[ "$output" == *"--rebase"* ]]
    [[ "$output" == *"git rebase --abort"* ]]
    [[ "$output" == *"--push-to-origin"* ]]
    [[ "$output" == *"--rewrite-origin"* ]]
    [[ "$output" == *"normal fast-forward push"* ]]
    [[ "$output" == *"--force-with-lease"* ]]
    [[ "$output" == *"--yes"* ]]
    [[ "$output" == *"non-TTY"* ]]
    [[ "$output" == *"--dry-run"* ]]
}

@test "fork-sync: rejects the superseded --push flag" {
    _setup_sync_fixture

    run bash "$SCRIPT" --push
    [ "$status" -ne 0 ]
    [[ "$output" == *"unknown option: --push"* ]]
}

@test "fork-sync: requires upstream_repo and upstream_branch in [fork] config" {
    export DEVENV_ROOT="$TEST_TEMP_DIR/config-root"
    export DEVENV_ROOT_SET=1
    mkdir -p "$DEVENV_ROOT"

    printf '[fork]\nupstream_repo=https://example.invalid/devenv.git\n' > "$DEVENV_ROOT/devenv.config"
    run bash "$SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" == *"upstream_branch"* ]]

    printf '[fork]\nupstream_branch=master\n' > "$DEVENV_ROOT/devenv.config"
    run bash "$SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" == *"upstream_repo"* ]]
}

@test "fork-sync: fetches upstream and reports no divergence" {
    _setup_sync_fixture

    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Behind: 0"* ]]
    [[ "$output" == *"Ahead: 0"* ]]
    [[ "$output" == *"No divergent commits"* ]]
}

@test "fork-sync: reports ahead and behind counts with both commit lists" {
    _setup_sync_fixture
    printf 'local change\n' > "$FORK_FIXTURE_WORKING_CLONE/local.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add local.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local ahead commit"

    printf 'upstream change\n' > "$FORK_FIXTURE_GH_CLONE/upstream.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add upstream.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Upstream ahead commit"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Behind: 1"* ]]
    [[ "$output" == *"Ahead: 1"* ]]
    [[ "$output" == *"< "*"Upstream ahead commit"* ]]
    [[ "$output" == *"> "*"Local ahead commit"* ]]
}

@test "fork-sync: reports behind-only upstream divergence" {
    _setup_sync_fixture
    printf 'upstream change\n' > "$FORK_FIXTURE_GH_CLONE/upstream.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add upstream.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Upstream ahead commit"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Behind: 1"* ]]
    [[ "$output" == *"Ahead: 0"* ]]
    [[ "$output" == *"< "*"Upstream ahead commit"* ]]
}

@test "fork-sync: reports ahead-only local divergence" {
    _setup_sync_fixture
    printf 'local change\n' > "$FORK_FIXTURE_WORKING_CLONE/local.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add local.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local ahead commit"

    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Behind: 0"* ]]
    [[ "$output" == *"Ahead: 1"* ]]
    [[ "$output" == *"> "*"Local ahead commit"* ]]
}

@test "fork-sync: --dry-run does not fetch upstream" {
    _setup_sync_fixture
    before_ref="$(git rev-parse --verify refs/remotes/upstream/master 2>/dev/null || true)"

    run bash "$SCRIPT" --dry-run --rebase
    [ "$status" -eq 0 ]
    [[ "$output" == *"dry run: would fetch upstream"* ]]
    [[ "$output" == *"dry run: would rebase the current branch"* ]]
    [ "$(git rev-parse --verify refs/remotes/upstream/master 2>/dev/null || true)" = "$before_ref" ]
}

@test "fork-sync: --rebase rebases local commits onto upstream without merge commits" {
    _setup_sync_fixture
    printf 'local change\n' > "$FORK_FIXTURE_WORKING_CLONE/local.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add local.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local ahead commit"

    printf 'upstream change\n' > "$FORK_FIXTURE_GH_CLONE/upstream.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add upstream.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Upstream ahead commit"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    run bash "$SCRIPT" --rebase
    [ "$status" -eq 0 ]
    git -C "$FORK_FIXTURE_WORKING_CLONE" merge-base --is-ancestor refs/remotes/upstream/master HEAD
    [ -z "$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-list --merges refs/remotes/upstream/master..HEAD)" ]
    [ "$(git -C "$FORK_FIXTURE_WORKING_CLONE" log -1 --format=%s)" = "Local ahead commit" ]
    [[ "$output" == *"Behind: 0"* ]]
    [[ "$output" == *"Ahead: 1"* ]]
}

@test "fork-sync: --rebase conflict prints exact abort guidance and leaves recoverable state" {
    _setup_sync_fixture
    printf 'local version\n' > "$FORK_FIXTURE_WORKING_CLONE/README.md"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add README.md
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local conflicting commit"

    printf 'upstream version\n' > "$FORK_FIXTURE_GH_CLONE/README.md"
    git -C "$FORK_FIXTURE_GH_CLONE" add README.md
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Upstream conflicting commit"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    run bash "$SCRIPT" --rebase
    [ "$status" -ne 0 ]
    [[ "$output" == *"Rebase conflict"* ]]
    [[ "$output" == *"git -C $FORK_FIXTURE_WORKING_CLONE rebase --abort"* ]]
    git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse --verify REBASE_HEAD >/dev/null
}

@test "fork-sync: non-TTY --push-to-origin without --yes fails before fetch, rebase, or push" {
    _setup_sync_fixture
    printf 'upstream change\n' > "$FORK_FIXTURE_GH_CLONE/upstream.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add upstream.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Upstream ahead commit"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    before_head="$(git rev-parse HEAD)"
    before_upstream_ref="$(git rev-parse --verify refs/remotes/upstream/master 2>/dev/null || true)"
    before_origin_ref="$(git rev-parse --verify refs/remotes/origin/master 2>/dev/null || true)"
    before_origin_tip="$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)"

    run bash -c 'bash "$@" </dev/null' _ "$SCRIPT" --rebase --push-to-origin
    [ "$status" -ne 0 ]
    [[ "$output" == *"--yes"* ]]
    [ "$(git rev-parse HEAD)" = "$before_head" ]
    [ "$(git rev-parse --verify refs/remotes/upstream/master 2>/dev/null || true)" = "$before_upstream_ref" ]
    [ "$(git rev-parse --verify refs/remotes/origin/master 2>/dev/null || true)" = "$before_origin_ref" ]
    [ "$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)" = "$before_origin_tip" ]
}

@test "fork-sync: --push-to-origin refuses a branch behind upstream unless --rebase is requested" {
    _setup_sync_fixture
    printf 'upstream change\n' > "$FORK_FIXTURE_GH_CLONE/upstream.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add upstream.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Upstream ahead commit"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master
    before_origin_tip="$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)"

    run bash -c 'bash "$@" </dev/null' _ "$SCRIPT" --push-to-origin --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"--rebase"* ]]
    [ "$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)" = "$before_origin_tip" ]
}

@test "fork-sync: --push-to-origin reports origin-only commits before pushing" {
    _setup_sync_fixture
    origin_updater="$TEST_TEMP_DIR/origin-updater"
    git clone -q "$FORK_FIXTURE_ADO_ORIGIN" "$origin_updater"
    git -C "$origin_updater" config user.email test@example.com
    git -C "$origin_updater" config user.name "Test User"
    printf 'origin change\n' > "$origin_updater/origin.txt"
    git -C "$origin_updater" add origin.txt
    git -C "$origin_updater" commit -qm "Origin-only commit"
    git -C "$origin_updater" push -q origin master
    before_origin_tip="$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)"

    run bash -c 'bash "$@" </dev/null' _ "$SCRIPT" --push-to-origin --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"Origin ahead: 1"* ]]
    [[ "$output" == *"Origin-only commit"* ]]
    [[ "$output" == *"--rewrite-origin"* ]]
    [ "$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)" = "$before_origin_tip" ]
}

@test "fork-sync: --push-to-origin fails closed when origin has no same-named branch" {
    _setup_sync_fixture
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -qb local-only

    run bash -c 'bash "$@" </dev/null' _ "$SCRIPT" --push-to-origin --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"origin branch 'local-only' was not fetched"* ]]
}

@test "fork-sync: --rewrite-origin requires --push-to-origin" {
    _setup_sync_fixture

    run bash "$SCRIPT" --rewrite-origin
    [ "$status" -ne 0 ]
    [[ "$output" == *"--rewrite-origin requires --push-to-origin"* ]]
}

@test "fork-sync: --rewrite-origin replaces origin-only commits only when explicitly confirmed" {
    _setup_sync_fixture
    printf 'local change\n' > "$FORK_FIXTURE_WORKING_CLONE/local.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add local.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local replacement commit"

    origin_updater="$TEST_TEMP_DIR/origin-updater"
    git clone -q "$FORK_FIXTURE_ADO_ORIGIN" "$origin_updater"
    git -C "$origin_updater" config user.email test@example.com
    git -C "$origin_updater" config user.name "Test User"
    printf 'origin-only change\n' > "$origin_updater/origin.txt"
    git -C "$origin_updater" add origin.txt
    git -C "$origin_updater" commit -qm "Origin-only commit"
    git -C "$origin_updater" push -q origin master

    run bash -c 'bash "$@" </dev/null' _ "$SCRIPT" --rewrite-origin --push-to-origin --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"rewrite"* ]]
    [ "$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)" = "$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" ]
    ! git -C "$FORK_FIXTURE_ADO_ORIGIN" merge-base --is-ancestor "$(git -C "$origin_updater" rev-parse master)" master
}

@test "fork-sync: TTY rewrite confirmation names origin-only commits and defaults to no" {
    _setup_sync_fixture
    printf 'local change\n' > "$FORK_FIXTURE_WORKING_CLONE/local.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add local.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local replacement commit"

    origin_updater="$TEST_TEMP_DIR/origin-updater"
    git clone -q "$FORK_FIXTURE_ADO_ORIGIN" "$origin_updater"
    git -C "$origin_updater" config user.email test@example.com
    git -C "$origin_updater" config user.name "Test User"
    printf 'origin-only change\n' > "$origin_updater/origin.txt"
    git -C "$origin_updater" add origin.txt
    git -C "$origin_updater" commit -qm "Origin-only commit"
    git -C "$origin_updater" push -q origin master
    before_origin_tip="$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)"

    run bash -c 'printf "n\n" | script -qec "bash \"$1\" --rewrite-origin --push-to-origin" /dev/null' _ "$SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Replace origin-only commits on origin/master? [y/N]"* ]]
    [[ "$output" == *"Push cancelled"* ]]
    [ "$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)" = "$before_origin_tip" ]
}

@test "fork-sync: rewrite lease rejects an origin update after fetch" {
    _setup_sync_fixture
    printf 'local replacement\n' > "$FORK_FIXTURE_WORKING_CLONE/local.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add local.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local replacement commit"

    origin_updater="$TEST_TEMP_DIR/origin-updater"
    git clone -q "$FORK_FIXTURE_ADO_ORIGIN" "$origin_updater"
    git -C "$origin_updater" config user.email test@example.com
    git -C "$origin_updater" config user.name "Test User"
    printf 'origin-only change\n' > "$origin_updater/origin.txt"
    git -C "$origin_updater" add origin.txt
    git -C "$origin_updater" commit -qm "Origin-only commit"
    git -C "$origin_updater" push -q origin master

    origin_racer="$TEST_TEMP_DIR/origin-racer"
    git clone -q "$FORK_FIXTURE_ADO_ORIGIN" "$origin_racer"
    git -C "$origin_racer" config user.email test@example.com
    git -C "$origin_racer" config user.name "Test User"
    printf 'concurrent origin update\n' > "$origin_racer/race.txt"
    git -C "$origin_racer" add race.txt
    git -C "$origin_racer" commit -qm "Concurrent origin commit"

    hook="$FORK_FIXTURE_WORKING_CLONE/.git/hooks/pre-push"
    printf '#!/usr/bin/env bash\nenv -i HOME=%q PATH=%q GIT_TERMINAL_PROMPT=0 git -C %q push -q origin HEAD:master\n' "$HOME" "$PATH" "$origin_racer" > "$hook"
    chmod +x "$hook"

    run bash -c 'bash "$@" </dev/null' _ "$SCRIPT" --rewrite-origin --push-to-origin --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"lease-protected rewrite of origin/master failed"* ]]
    [ "$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)" = "$(git -C "$origin_racer" rev-parse HEAD)" ]
}

@test "fork-sync: --push-to-origin is a no-op when local and origin tips match" {
    _setup_sync_fixture
    before_origin_tip="$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)"

    run bash -c 'bash "$@" </dev/null' _ "$SCRIPT" --push-to-origin --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"No push needed"* ]]
    [ "$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)" = "$before_origin_tip" ]
}

@test "fork-sync: --push-to-origin normally pushes a fast-forward" {
    _setup_sync_fixture
    printf 'local change\n' > "$FORK_FIXTURE_WORKING_CLONE/local.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add local.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local ahead commit"

    run bash -c 'bash "$@" </dev/null' _ "$SCRIPT" --push-to-origin --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Pushed"* ]]
    [ "$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)" = "$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" ]
}

@test "fork-sync: refuses when origin pushurl points at configured upstream" {
    _setup_sync_fixture
    printf 'local change\n' > "$FORK_FIXTURE_WORKING_CLONE/local.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add local.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local ahead commit"
    git -C "$FORK_FIXTURE_WORKING_CLONE" remote set-url --push origin "$FORK_FIXTURE_UPSTREAM"
    upstream_before="$(git -C "$FORK_FIXTURE_UPSTREAM" rev-parse master)"
    origin_before="$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)"

    run bash -c 'bash "$@" </dev/null' _ "$SCRIPT" --push-to-origin --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"origin push destination matches configured upstream"* ]]
    [ "$(git -C "$FORK_FIXTURE_UPSTREAM" rev-parse master)" = "$upstream_before" ]
    [ "$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)" = "$origin_before" ]
}

@test "fork-sync: TTY push confirmation defaults to no" {
    _setup_sync_fixture
    printf 'local change\n' > "$FORK_FIXTURE_WORKING_CLONE/local.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add local.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local ahead commit"
    before_origin_tip="$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)"

    run bash -c 'printf "n\n" | script -qec "bash \"$1\" --push-to-origin" /dev/null' _ "$SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Proceed with push? [y/N]"* ]]
    [[ "$output" == *"Push cancelled"* ]]
    [ "$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)" = "$before_origin_tip" ]
}
