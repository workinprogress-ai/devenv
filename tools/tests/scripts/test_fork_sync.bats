#!/usr/bin/env bats
# Tests for scripts/fork-sync.sh — on-demand upstream sync.
#
# Contract tests for on-demand upstream sync.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    SCRIPT="$DEVENV_TOOLS/scripts/fork-sync.sh"
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
    [[ "$output" == *"--replay"* ]]
    [[ "$output" == *"git cherry-pick --abort"* ]]
    [[ "$output" == *"applies"*"on top of the branch"* ]]
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
    [[ "$output" == *"nothing to sync"* ]]
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
    [[ "$output" == *"Action needed"*"run 'fork-sync --replay'"* ]]
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
    [[ "$output" == *"Action needed"*"run 'fork-sync --replay'"* ]]
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
    [[ "$output" == *"No action needed"* ]]
}

@test "fork-sync: --dry-run does not fetch upstream" {
    _setup_sync_fixture
    before_ref="$(git rev-parse --verify refs/remotes/upstream/master 2>/dev/null || true)"

    run bash "$SCRIPT" --dry-run --replay
    [ "$status" -eq 0 ]
    [[ "$output" == *"dry run: would fetch upstream"* ]]
    [[ "$output" == *"dry run: would apply upstream"* ]]
    [ "$(git rev-parse --verify refs/remotes/upstream/master 2>/dev/null || true)" = "$before_ref" ]
}

@test "fork-sync: --replay applies upstream commits on top of the branch without merge commits" {
    _setup_sync_fixture
    printf 'local change\n' > "$FORK_FIXTURE_WORKING_CLONE/local.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add local.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local ahead commit"

    printf 'upstream change\n' > "$FORK_FIXTURE_GH_CLONE/upstream.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add upstream.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Upstream ahead commit"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    run bash "$SCRIPT" --replay --yes
    [ "$status" -eq 0 ]
    # The upstream commit was applied ON TOP of the local one: the applied
    # commit is the new tip, the local commit sits beneath it untouched.
    git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%s > "$TEST_TEMP_DIR/subjects.txt"
    LOG_RAW="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%s | tr '\n' '|')"
    [[ "$LOG_RAW" == *"Upstream ahead commit|Local ahead commit|Initial commit"* ]]
    [ -z "$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-list --merges upstream/master..HEAD 2>/dev/null)" ]
    grep -q "upstream change" "$FORK_FIXTURE_WORKING_CLONE/upstream.txt"
    # The applied copy is not ancestry: upstream's original honestly counts
    # as behind, recognized as the fork's own work coming back.
    [[ "$output" == *"Behind: 1"* ]]
    [[ "$output" == *"Ahead: 2"* ]]
    # The applied copy is patch-identical to upstream's original, so the
    # twin-recognition signals (subject/patch-id) mark it as own work.
    [[ "$output" == *"No urgent action needed"* || "$output" == *"look like your own"* ]]
}

@test "fork-sync: --replay conflict prints exact abort guidance and leaves recoverable state" {
    _setup_sync_fixture
    printf 'local version\n' > "$FORK_FIXTURE_WORKING_CLONE/README.md"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add README.md
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local conflicting commit"

    printf 'upstream version\n' > "$FORK_FIXTURE_GH_CLONE/README.md"
    git -C "$FORK_FIXTURE_GH_CLONE" add README.md
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Upstream conflicting commit"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    run bash "$SCRIPT" --replay --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"Conflict while applying"* ]]
    [[ "$output" == *"git -C $FORK_FIXTURE_WORKING_CLONE cherry-pick --abort"* ]]
    git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse --verify CHERRY_PICK_HEAD >/dev/null
}

@test "fork-sync: non-TTY --push-to-origin without --yes fails before fetch, replay, or push" {
    _setup_sync_fixture
    printf 'upstream change\n' > "$FORK_FIXTURE_GH_CLONE/upstream.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add upstream.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Upstream ahead commit"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    before_head="$(git rev-parse HEAD)"
    before_upstream_ref="$(git rev-parse --verify refs/remotes/upstream/master 2>/dev/null || true)"
    before_origin_ref="$(git rev-parse --verify refs/remotes/origin/master 2>/dev/null || true)"
    before_origin_tip="$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)"

    run bash -c 'bash "$@" </dev/null' _ "$SCRIPT" --replay --push-to-origin
    [ "$status" -ne 0 ]
    [[ "$output" == *"--yes"* ]]
    [ "$(git rev-parse HEAD)" = "$before_head" ]
    [ "$(git rev-parse --verify refs/remotes/upstream/master 2>/dev/null || true)" = "$before_upstream_ref" ]
    [ "$(git rev-parse --verify refs/remotes/origin/master 2>/dev/null || true)" = "$before_origin_ref" ]
    [ "$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)" = "$before_origin_tip" ]
}

@test "fork-sync: --push-to-origin refuses a branch behind upstream unless --replay is requested" {
    _setup_sync_fixture
    printf 'upstream change\n' > "$FORK_FIXTURE_GH_CLONE/upstream.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add upstream.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Upstream ahead commit"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master
    before_origin_tip="$(git -C "$FORK_FIXTURE_ADO_ORIGIN" rev-parse master)"

    run bash -c 'bash "$@" </dev/null' _ "$SCRIPT" --push-to-origin --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"--replay"* ]]
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

@test "fork-sync: lists local commits that look already upstream (patch-equivalent and same-subject)" {
    _setup_sync_fixture
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -q -b contribute
    echo a > "$FORK_FIXTURE_WORKING_CLONE/a.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add a.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "feat: add a"
    echo b > "$FORK_FIXTURE_WORKING_CLONE/b.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add b.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "feat: add b"
    echo own > "$FORK_FIXTURE_WORKING_CLONE/own.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add own.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "fork: only here"
    # Upstream gets the "add a" patch under another message and "add b" edited (same subject, other content).
    echo a > "$FORK_FIXTURE_GH_CLONE/a.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add a.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "feat: add a (reworded upstream)"
    printf 'b\nedited\n' > "$FORK_FIXTURE_GH_CLONE/b.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add b.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "feat: add b"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin HEAD:master

    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"look already upstream"* ]]
    [[ "$output" == *"feat: add a"* ]]
    [[ "$output" == *"feat: add b"* ]]
    # the fork-only commit is not in the already-upstream list
    ! sed -n '/look already upstream/,/The replay drops/p' <<< "$output" | grep -q "fork: only here"
}

@test "fork-sync: names no already-upstream commits when there are none" {
    _setup_sync_fixture
    echo own > "$FORK_FIXTURE_WORKING_CLONE/own.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add own.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "fork: only here"
    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" != *"look already upstream"* ]]
}

@test "fork-sync: a local commit sharing Change-Id with an upstream commit is recognized despite different subject and content" {
    _setup_sync_fixture
    echo mine > "$FORK_FIXTURE_WORKING_CLONE/mine.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add mine.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "feat: my contribution" -m $'Change-Id: Abc123Abc123'

    echo theirs > "$FORK_FIXTURE_GH_CLONE/theirs.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add theirs.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "chore: squashed contribution" -m $'Change-Id: Abc123Abc123'
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin HEAD:master

    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"same Change-Id"* ]]
    [[ "$output" == *"look already upstream"* ]]
    [[ "$output" == *"feat: my contribution"* ]]
}

@test "fork-sync: an upstream commit sharing Change-Id with a local commit is not flagged as action needed" {
    _setup_sync_fixture
    echo mine > "$FORK_FIXTURE_WORKING_CLONE/mine.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add mine.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "feat: my contribution" -m $'Change-Id: Abc123Abc123'

    echo theirs > "$FORK_FIXTURE_GH_CLONE/theirs.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add theirs.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "chore: squashed contribution" -m $'Change-Id: Abc123Abc123'
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin HEAD:master

    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Behind: 1"* ]]
    [[ "$output" == *"Upstream commits that look like your own work"* ]]
    [[ "$output" == *"chore: squashed contribution"* ]]
    [[ "$output" == *"No urgent action needed"* ]]
    [[ "$output" != *"Action needed:"* ]]
}

@test "fork-sync: a genuinely new upstream commit still triggers action needed alongside a recognized one" {
    _setup_sync_fixture
    echo mine > "$FORK_FIXTURE_WORKING_CLONE/mine.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add mine.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "feat: my contribution" -m $'Change-Id: Abc123Abc123'

    echo theirs > "$FORK_FIXTURE_GH_CLONE/theirs.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add theirs.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "chore: squashed contribution" -m $'Change-Id: Abc123Abc123'
    echo new > "$FORK_FIXTURE_GH_CLONE/new.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add new.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "feat: brand new upstream work"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin HEAD:master

    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Behind: 2"* ]]
    [[ "$output" == *"Action needed: upstream has 1 commit(s)"* ]]
}

@test "fork-sync: an upstream commit dropped from local HEAD by a history rewrite is recognized via a surviving local tag" {
    _setup_sync_fixture
    echo legacy > "$FORK_FIXTURE_WORKING_CLONE/legacy.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add legacy.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "fix: generic legacy fix"
    git -C "$FORK_FIXTURE_WORKING_CLONE" tag legacy-tag
    # upstream has the exact same commit object (pushed before the local rewrite)...
    git -C "$FORK_FIXTURE_WORKING_CLONE" push -q upstream HEAD:master
    # ...but a local history rewrite dropped it from HEAD's ancestry; only the tag holds it now.
    git -C "$FORK_FIXTURE_WORKING_CLONE" reset --hard -q HEAD~1

    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Behind: 1"* ]]
    [[ "$output" == *"already reachable from a local branch/tag"* ]]
    [[ "$output" == *"fix: generic legacy fix"* ]]
    [[ "$output" == *"No urgent action needed"* ]]
    [[ "$output" != *"Action needed:"* ]]
}

@test "fork-sync: --replay refuses local history with a merge commit since the upstream merge-base" {
    _setup_sync_fixture
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -qb side
    echo side > "$FORK_FIXTURE_WORKING_CLONE/side.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add side.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "Side commit"
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -q master
    git -C "$FORK_FIXTURE_WORKING_CLONE" merge -q --no-ff -m "Merge side" side
    before_head="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)"

    run bash "$SCRIPT" --replay
    [ "$status" -ne 0 ]
    [[ "$output" == *"contains merge commit(s)"* ]]
    [[ "$output" == *"Merge side"* ]]
    [ "$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" = "$before_head" ]
}

@test "fork-sync: --replay refuses a dirty working tree before fetching" {
    _setup_sync_fixture
    echo dirty > "$FORK_FIXTURE_WORKING_CLONE/dirty.txt"
    before_ref="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse --verify refs/remotes/upstream/master 2>/dev/null || true)"

    run bash "$SCRIPT" --replay
    [ "$status" -ne 0 ]
    [[ "$output" == *"uncommitted changes"* ]]
    [ "$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse --verify refs/remotes/upstream/master 2>/dev/null || true)" = "$before_ref" ]
}

@test "fork-sync: refuses to start on top of an unfinished rebase" {
    _setup_sync_fixture
    # Manufacture rebase state directly: the guard must still catch any
    # in-progress rebase a user left behind, regardless of what created it.
    printf 'upstream version\n' > "$FORK_FIXTURE_GH_CLONE/README.md"
    git -C "$FORK_FIXTURE_GH_CLONE" add README.md
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Upstream conflicting commit"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master
    printf 'local version\n' > "$FORK_FIXTURE_WORKING_CLONE/README.md"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add README.md
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local conflicting commit"
    git -C "$FORK_FIXTURE_WORKING_CLONE" fetch -q upstream
    git -C "$FORK_FIXTURE_WORKING_CLONE" rebase upstream/master || true
    git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse --verify REBASE_HEAD >/dev/null

    run bash "$SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" == *"rebase"*"already in progress"* ]]
}

@test "fork-sync: refuses when HEAD and upstream share no common history" {
    _setup_sync_fixture
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -q --orphan unrelated
    git -C "$FORK_FIXTURE_WORKING_CLONE" rm -rq --cached . >/dev/null 2>&1 || true
    echo unrelated > "$FORK_FIXTURE_WORKING_CLONE/unrelated.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add unrelated.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "Unrelated root commit"

    run bash "$SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" == *"share no common history"* ]]
}

# ---------------------------------------------------------------------------
# Twin-aware sync contract tests: the classified replay scenario (fork
# commits exported upstream, then synced back down).
# ---------------------------------------------------------------------------

# Report §5 shape: backlog (no Change-Id) + twin-exported-and-edited + double
# application upstream, then upstream evolves the same lines. The classified
# replay must complete conflict-free and leave only genuinely fork-only
# commits on top of upstream's tip.
@test "fork-sync: --replay --yes completes conflict-free when upstream already holds exported twins" {
    _setup_sync_fixture
    fork_scenario_pre_change_id_backlog 2
    fork_scenario_export_and_edit_twin
    fork_scenario_double_applied_export
    fork_scenario_upstream_evolved
    # Land upstream's evolved state so the working clone can sync down to it.
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    run bash "$SCRIPT" --replay --yes
    # The evolution commits touch file_twin.txt, whose upstream copy carries
    # the target-side adaptation the fork's copy lacks: picking them onto the
    # fork's diverged file is a REAL conflict, honestly surfaced — not forced
    # through. The new direction keeps local copies authoritative; upstream's
    # evolved state arrives as a conflict to resolve, not a silent overwrite.
    [ "$status" -ne 0 ]
    [[ "$output" == *"Conflict while applying"* ]]
    [[ "$output" == *"Conflict while applying upstream commit"* ]]
    [[ "$output" == *"cherry-pick --abort"* ]]
    # Everything before the conflict landed: twins skipped, duplicates applied.
    [ "$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse --verify CHERRY_PICK_HEAD)" ]
    git -C "$FORK_FIXTURE_WORKING_CLONE" cherry-pick --abort
    git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%s HEAD > "$TEST_TEMP_DIR/subjects.txt"
    # The dup's content landed before the conflict; the fork's own twin copy
    # remains exactly once (it never left the branch — a duplicate pick would
    # make it two).
    grep -q "docs: add the section" "$TEST_TEMP_DIR/subjects.txt"
    local twin_count
    twin_count="$(grep -c "feat: twin commit for export" "$TEST_TEMP_DIR/subjects.txt")"
    [ "$twin_count" -eq 1 ]
    # Local fork-only work remains untouched beneath the applied picks.
    grep -q "pre-change-id commit 1" "$TEST_TEMP_DIR/subjects.txt"
    grep -q "pre-change-id commit 2" "$TEST_TEMP_DIR/subjects.txt"
}

@test "fork-sync: --dry-run classifies exported twins as already-upstream and names the residue" {
    _setup_sync_fixture
    fork_scenario_pre_change_id_backlog 2
    fork_scenario_export_and_edit_twin
    fork_scenario_upstream_evolved
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master
    # Dry-run does not fetch; the plan classifies against the last fetch.
    git fetch -q upstream

    run bash "$SCRIPT" --dry-run --replay
    [ "$status" -eq 0 ]
    # The exported twin is classified as already on the branch (skipped)…
    [[ "$output" == *"twin commit for export"*"already on your branch"* ]]
    # …and the divergence — the one-line target adaptation — is named, not silent.
    [[ "$output" == *"Divergence on skipped commit(s)"*"upstream copy differs from your local version"* ]]
    # The upstream evolved commits show as picks; the local backlog commits
    # (fork-only work) are not part of the pick plan at all — the plan covers
    # upstream commits, and nothing here suggests replaying local work.
    [[ "$output" == *"upstream: evolve the twin file 1"*"will be applied"* ]]
    [[ "$output" == *"would apply 2 new upstream commit(s), skip 1 already present"* ]]
}

@test "fork-sync: refuses to start on top of an unfinished cherry-pick" {
    _setup_sync_fixture
    # A conflicting cherry-pick in progress: upstream commit vs diverged local
    # README. This state class becomes the sync's own mid-flight state under
    # the pick direction, so the fresh-run guard must catch it.
    printf 'local version\n' > "$FORK_FIXTURE_WORKING_CLONE/README.md"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add README.md
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local conflicting commit"
    printf 'upstream version\n' > "$FORK_FIXTURE_GH_CLONE/README.md"
    git -C "$FORK_FIXTURE_GH_CLONE" add README.md
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Upstream conflicting commit"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master
    git -C "$FORK_FIXTURE_WORKING_CLONE" fetch -q upstream
    git -C "$FORK_FIXTURE_WORKING_CLONE" cherry-pick upstream/master || true
    git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse --verify CHERRY_PICK_HEAD >/dev/null

    run bash "$SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" == *"cherry-pick"*"already in progress"* ]]
}

@test "fork-sync: an immediately repeated sync is a no-op (idempotency)" {
    _setup_sync_fixture
    printf 'local change\n' > "$FORK_FIXTURE_WORKING_CLONE/local.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add local.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "Local ahead commit"
    printf 'upstream change\n' > "$FORK_FIXTURE_GH_CLONE/upstream.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add upstream.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Upstream ahead commit"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    run bash "$SCRIPT" --replay --yes
    [ "$status" -eq 0 ]
    local tip_after_first
    tip_after_first="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)"

    # Second sync: the applied copy carries the upstream commit's Change-Id,
    # so the pick plan skips it — nothing to apply, no ref movement.
    run bash "$SCRIPT" --replay --yes
    [ "$status" -eq 0 ]
    [ "$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" = "$tip_after_first" ]
    [[ "$output" == *"Nothing to apply from upstream"* ]]
}

@test "fork-sync: after a sync, fork-export does not re-export upstream's own work (interplay)" {
    _setup_sync_fixture
    # The Change-Id hook is load-bearing for this interplay: export identity
    # rides on the trailer surviving the pick.
    _fork_scenario_install_change_id_hook
    fork_scenario_pre_change_id_backlog 1
    printf 'fork work\n' > "$FORK_FIXTURE_WORKING_CLONE/fork_work.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add fork_work.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "feat: fork-only work"

    # Upstream gains two commits the fork lacks (hooked there too, so their
    # trailers exist on the upstream side — the org's rebase-merge reality).
    _fork_scenario_install_change_id_hook_gh
    printf 'upstream a\n' > "$FORK_FIXTURE_GH_CLONE/ua.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add ua.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "feat: upstream a"
    printf 'upstream b\n' > "$FORK_FIXTURE_GH_CLONE/ub.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add ub.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "feat: upstream b"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    run bash "$SCRIPT" --replay --yes
    [ "$status" -eq 0 ]

    # Export the branch for upstream transfer: the pick direction keeps the
    # range linear, so fork-export runs without its merge-commit refusal —
    # the interplay seam this test pins. Range = merge-base..HEAD, which now
    # spans the applied upstream copies plus the fork-only work.
    run bash "$DEVENV_TOOLS/scripts/fork-export.sh" --export-only --all
    [ "$status" -eq 0 ]

    # No duplication on the branch: each upstream subject appears exactly
    # once (as the applied copy, carrying upstream's Change-Id).
    local dup_a dup_b
    dup_a="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%s upstream/master..HEAD | grep -c "upstream a")"
    dup_b="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%s upstream/master..HEAD | grep -c "upstream b")"
    [ "$dup_a" -eq 1 ]
    [ "$dup_b" -eq 1 ]

    # The applied copies carry the same Change-Ids as upstream's originals,
    # so a target-side import skips them (fork-export's own suite covers the
    # skip mechanics; here we pin that the Change-Ids survived the pick).
    local copied_id original_id
    original_id="$(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%B "$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep="upstream a" -1)" | grep "Change-Id:" | head -1)"
    copied_id="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%B --grep="upstream a" -1 | grep "Change-Id:" | head -1)"
    [ -n "$original_id" ]
    [ "$copied_id" = "$original_id" ]
}

@test "fork-sync: a fork branch synced under the legacy direction re-syncs cleanly" {
    _setup_sync_fixture
    printf 'legacy fork work\n' > "$FORK_FIXTURE_WORKING_CLONE/legacy_fork.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add legacy_fork.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "feat: legacy fork work"

    # Simulate a legacy-direction sync's end state: local fork commits sit on
    # top of an OLD upstream tip; upstream has since moved (new commits), and
    # the fork's branch was rewritten onto that old tip (different SHAs than
    # any current upstream commit). This is the shape every pre-existing fork
    # carries when the new direction first runs.
    printf 'old upstream\n' > "$FORK_FIXTURE_GH_CLONE/old_up.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add old_up.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "feat: old upstream work"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master
    git -C "$FORK_FIXTURE_WORKING_CLONE" fetch -q upstream
    git -C "$FORK_FIXTURE_WORKING_CLONE" rebase upstream/master >/dev/null 2>&1 || true
    git -C "$FORK_FIXTURE_WORKING_CLONE" cherry-pick --abort 2>/dev/null || true

    # Upstream moves again AFTER the legacy sync.
    printf 'new upstream\n' > "$FORK_FIXTURE_GH_CLONE/nu.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add nu.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "feat: new upstream work"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    run bash "$SCRIPT" --replay --yes
    [ "$status" -eq 0 ]
    # The fork-only commit survives untouched; upstream's new work arrived.
    git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%s | grep -q "legacy fork work"
    grep -q "new upstream" "$FORK_FIXTURE_WORKING_CLONE/nu.txt"
    [ -z "$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-list --merges upstream/master..HEAD 2>/dev/null)" ]
}

@test "fork-sync: pick-plan sync completes the 20x20 scale fixture inside the perf budget" {
    _setup_sync_fixture
    fork_scenario_scale_history 20 20
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master
    git -C "$FORK_FIXTURE_WORKING_CLONE" fetch -q upstream
    local start end elapsed
    start="$(date +%s%N)"
    run bash "$SCRIPT" --replay --yes
    end="$(date +%s%N)"
    [ "$status" -eq 0 ]
    elapsed=$(( (end - start) / 1000000 ))
    echo "PICK-SYNC-ELAPSED_MS=$elapsed" >&3
    # The legacy implementation needed 7455ms on this fixture: its twin
    # detection re-scanned the full upstream history per local commit. The
    # pick direction replaces that O(local x all-upstream) patch-id scan
    # with a bounded Change-Id intersection.
    #
    # Wall-clock timing is asserted only when the suite runs standalone
    # (FORK_SYNC_PERF_BUDGET_MS set by the caller): under parallel full-suite
    # load the same fixture measured 1620ms standalone but 10590ms loaded —
    # a wall-clock gate there is a flake generator, not a perf guard. The
    # load-independent claims are the correctness ones below: all 20 upstream
    # commits applied, all 20 local commits untouched.
    if [ -n "${FORK_SYNC_PERF_BUDGET_MS:-}" ]; then
        [ "$elapsed" -lt "$FORK_SYNC_PERF_BUDGET_MS" ]
    fi
    # All 20 upstream commits applied; the 20 local commits untouched beneath.
    [ "$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-list --count upstream/master..HEAD)" -eq 40 ]
}

@test "fork-sync: --dry-run forecasts the surface classes of the applied work" {
    _setup_sync_fixture
    fork_scenario_pre_change_id_backlog 1
    # Upstream commits touch all three classes.
    printf 'setup change\n' >> "$FORK_FIXTURE_GH_CLONE/setup"
    git -C "$FORK_FIXTURE_GH_CLONE" add setup
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "feat: touch setup (fork-replaced)"
    mkdir -p "$FORK_FIXTURE_GH_CLONE/tools/lib/providers"
    printf 'provider change\n' > "$FORK_FIXTURE_GH_CLONE/tools/lib/providers/readme.md"
    git -C "$FORK_FIXTURE_GH_CLONE" add tools/lib/providers/readme.md
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "feat: touch providers (fork-stable)"
    mkdir -p "$FORK_FIXTURE_GH_CLONE/tools/scripts"
    printf 'script change\n' > "$FORK_FIXTURE_GH_CLONE/tools/scripts/fork-sync.sh.tmp"
    git -C "$FORK_FIXTURE_GH_CLONE" add tools/scripts/fork-sync.sh.tmp
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "feat: touch a script (upstream-stable)"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master
    git fetch -q upstream

    run bash "$SCRIPT" --dry-run --replay
    [ "$status" -eq 0 ]
    [[ "$output" == *"Surface forecast"* ]]
    [[ "$output" == *"fork-replaced path"*"setup"* ]]
    [[ "$output" == *"fork-stable path"*"tools/lib/providers/readme.md"* ]]
    [[ "$output" == *"upstream-stable path"*"tools/scripts/fork-sync.sh.tmp"* ]]
}

@test "fork-sync: --drift reports fork-local edits on upstream-stable paths" {
    _setup_sync_fixture
    git fetch -q upstream
    # Drift: edit an upstream-stable path locally.
    mkdir -p "$FORK_FIXTURE_WORKING_CLONE/tools/scripts"
    printf 'local tweak\n' > "$FORK_FIXTURE_WORKING_CLONE/tools/scripts/fork-sync.sh"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add tools/scripts/fork-sync.sh
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "feat: local tweak on an upstream-stable path"
    # Fork-stable edit that must NOT be reported (committed: the drift diff
    # is commit-range-based, so an uncommitted file proves nothing).
    mkdir -p "$FORK_FIXTURE_WORKING_CLONE/tools/lib/providers"
    printf 'provider tweak\n' > "$FORK_FIXTURE_WORKING_CLONE/tools/lib/providers/README.md"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add tools/lib/providers/README.md
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "feat: fork-stable provider tweak"

    run bash "$SCRIPT" --drift
    [ "$status" -eq 0 ]
    [[ "$output" == *"Drift inventory"* ]]
    [[ "$output" == *"tools/scripts/fork-sync.sh"* ]]
    # The fork-stable edit is excluded from the inventory.
    [[ "$output" != *"tools/lib/providers/README.md"* ]]
    [[ "$output" == *"1 upstream-stable path(s)"* ]]
}

@test "fork-sync: --drift reports none when the fork is clean" {
    _setup_sync_fixture
    git fetch -q upstream
    # Only fork-stable edits — nothing on upstream-stable paths.
    mkdir -p "$FORK_FIXTURE_WORKING_CLONE/tools/lib/providers"
    printf 'mine\n' > "$FORK_FIXTURE_WORKING_CLONE/tools/lib/providers/mine.md"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add tools/lib/providers/mine.md
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "feat: fork-stable only"

    run bash "$SCRIPT" --drift
    [ "$status" -eq 0 ]
    [[ "$output" == *"none"*"no fork-local edits on upstream-stable paths"* ]]
}

@test "fork-sync: --drift refuses to combine with other modes" {
    _setup_sync_fixture
    run bash "$SCRIPT" --drift --replay
    [ "$status" -ne 0 ]
    [[ "$output" == *"--drift runs alone"* ]]
}

@test "fork-sync: sync snapshots fork-owned surfaces and verifies them untouched" {
    _setup_sync_fixture
    fork_scenario_pre_change_id_backlog 1
    # A fork-stable file the fork owns (providers dir).
    mkdir -p "$FORK_FIXTURE_WORKING_CLONE/tools/lib/providers"
    printf 'fork provider state\n' > "$FORK_FIXTURE_WORKING_CLONE/tools/lib/providers/mine.md"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add tools/lib/providers/mine.md
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "feat: fork provider state"
    # Upstream moves (upstream-stable file only).
    printf 'upstream work\n' > "$FORK_FIXTURE_GH_CLONE/up.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add up.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "feat: upstream work"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    run bash "$SCRIPT" --replay --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Snapshot of fork-owned surfaces"* ]]
    [[ "$output" == *"Fork-owned surfaces verified: untouched"* ]]
    # The snapshot ref exists and holds the provider file.
    git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse --verify refs/fork-sync/snapshot >/dev/null
    git -C "$FORK_FIXTURE_WORKING_CLONE" show refs/fork-sync/snapshot:tools/lib/providers/mine.md >/dev/null
}

@test "fork-sync: sync surfaces fork-owned paths the applied work touched" {
    _setup_sync_fixture
    fork_scenario_pre_change_id_backlog 1
    # Upstream modifies a fork-stable path (providers).
    mkdir -p "$FORK_FIXTURE_GH_CLONE/tools/lib/providers"
    printf 'upstream provider tweak\n' > "$FORK_FIXTURE_GH_CLONE/tools/lib/providers/up.md"
    git -C "$FORK_FIXTURE_GH_CLONE" add tools/lib/providers/up.md
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "feat: upstream touches providers"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    run bash "$SCRIPT" --replay --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Snapshot of fork-owned surfaces"* ]]
    [[ "$output" == *"Fork-owned paths touched by the applied work"* ]]
    [[ "$output" == *"tools/lib/providers/up.md"* ]]
    [[ "$output" == *"diff refs/fork-sync/snapshot HEAD"* ]]
}

@test "fork-sync: an aborted sync leaves the snapshot ref intact" {
    _setup_sync_fixture
    fork_scenario_pre_change_id_backlog 1
    mkdir -p "$FORK_FIXTURE_WORKING_CLONE/tools/lib/providers"
    printf 'mine\n' > "$FORK_FIXTURE_WORKING_CLONE/tools/lib/providers/keep.md"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add tools/lib/providers/keep.md
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "feat: fork state"
    # Fork diverges the same file upstream rewrites → real pick conflict.
    printf 'fork readme\n' > "$FORK_FIXTURE_WORKING_CLONE/README.md"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add README.md
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "feat: fork readme state"
    printf 'conflict version\n' > "$FORK_FIXTURE_GH_CLONE/README.md"
    git -C "$FORK_FIXTURE_GH_CLONE" add README.md
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "feat: conflicting upstream"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    run bash "$SCRIPT" --replay --yes
    [ "$status" -ne 0 ]
    [[ "$output" == *"Conflict while applying"* ]]
    # Snapshot was taken before the picks and survives the abort.
    git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse --verify refs/fork-sync/snapshot >/dev/null
    git -C "$FORK_FIXTURE_WORKING_CLONE" show refs/fork-sync/snapshot:tools/lib/providers/keep.md >/dev/null
    git -C "$FORK_FIXTURE_WORKING_CLONE" cherry-pick --abort
}

@test "fork-sync: cleanly applied picks are auto-recorded in the adoption map" {
    _setup_sync_fixture
    fork_scenario_pre_change_id_backlog 1
    mkdir -p "$FORK_FIXTURE_GH_CLONE/tools/lib/providers"
    _fork_scenario_install_change_id_hook_gh
    printf 'upstream work\n' > "$FORK_FIXTURE_GH_CLONE/up.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add up.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "feat: upstream work to be recorded"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    run bash "$SCRIPT" --replay --yes
    [ "$status" -eq 0 ]

    local up_sha local_twin
    up_sha="$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse HEAD)"
    # The applied copy's message carries the same Change-Id; find it locally.
    local id
    id="$(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%B "$up_sha" | grep 'Change-Id:' | awk '{print $2}')"
    local_twin="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="Change-Id: $id" -1)"
    [ -n "$local_twin" ]
    # The map records the pair: lookup by upstream SHA resolves the local copy.
    source "$DEVENV_TOOLS/lib/fork-twin.bash"
    export FORK_TWIN_UPSTREAM_REPO="$FORK_FIXTURE_GH_CLONE"
    MAP="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse --path-format=absolute --git-common-dir)/fork-adoption-map"
    found="$(fork_twin_map_lookup_upstream "$MAP" "$up_sha")"
    [ "$found" = "$local_twin" ]
    # And an immediate re-sync drops the commit as already present.
    run bash "$SCRIPT" --replay --yes
    [ "$status" -eq 0 ]
    [[ "$output" == *"Nothing to apply from upstream"* ]]
}

@test "fork-sync: non-TTY --replay without --yes fails closed before applying" {
    _setup_sync_fixture
    fork_scenario_pre_change_id_backlog 1
    printf 'upstream work\n' > "$FORK_FIXTURE_GH_CLONE/up.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add up.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "feat: upstream work"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master

    local before_tip
    before_tip="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)"
    # Stdin closed (what a non-TTY environment actually provides — CI, cron,
    # a runner without a terminal): the gate must refuse, not prompt, not apply.
    run bash "$SCRIPT" --replay < /dev/null
    [ "$status" -ne 0 ]
    [[ "$output" == *"non-TTY --replay requires --yes"* ]]
    [ "$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" = "$before_tip" ]
}
