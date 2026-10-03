#!/usr/bin/env bats
# Tests for lib/providers/azure/fork-export.sh — export commits for transfer
# into a real GitHub clone.
#
# Contract tests for exporting commits into a real GitHub clone.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    SCRIPT="$DEVENV_TOOLS/lib/providers/azure/fork-export.sh"
}

teardown() {
    test_helper_teardown
}

_setup_fork_export_fixture() {
    create_fork_fixture_trio "$TEST_TEMP_DIR/fork-fixture"
    export DEVENV_ROOT="$TEST_TEMP_DIR/config-root"
    export DEVENV_ROOT_SET=1
    mkdir -p "$DEVENV_ROOT"
    printf '[fork]\nupstream_repo=%s\nupstream_branch=master\n' "$FORK_FIXTURE_UPSTREAM" > "$DEVENV_ROOT/devenv.config"
    git -C "$FORK_FIXTURE_WORKING_CLONE" remote add upstream "$FORK_FIXTURE_UPSTREAM"
    git -C "$FORK_FIXTURE_WORKING_CLONE" fetch -q upstream
    cd "$FORK_FIXTURE_WORKING_CLONE"
}

_add_export_commit() {
    printf '%s\n' "$1" >> "$FORK_FIXTURE_WORKING_CLONE/changes.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add changes.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "$1"
}

@test "fork-export: script has valid syntax" {
    bash -n "$SCRIPT"
}

@test "fork-export: --help prints usage without implementing logic" {
    run bash "$SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"fork-export.sh"* ]]
    [[ "$output" == *"merge-base"* ]]
    [[ "$output" == *"upstream/<branch>"* ]]
    [[ "$output" == *"[<end-ref>]"* ]]
    [[ "$output" == *"--format bundle|patch|both"* ]]
    [[ "$output" == *"--apply-to <path>"* ]]
    [[ "$output" == *".local-artifacts/fork-export/<range-slug>/"* ]]
    [[ "$output" == *"--dry-run"* ]]
}

@test "fork-export: requires upstream_repo and upstream_branch in [fork] config" {
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

@test "fork-export: missing upstream remote explains how to set it up" {
    create_fork_fixture_trio "$TEST_TEMP_DIR/fork-fixture"
    export DEVENV_ROOT="$TEST_TEMP_DIR/config-root"
    export DEVENV_ROOT_SET=1
    mkdir -p "$DEVENV_ROOT"
    printf '[fork]\nupstream_repo=%s\nupstream_branch=master\n' "$FORK_FIXTURE_UPSTREAM" > "$DEVENV_ROOT/devenv.config"

    run bash "$SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" == *"fork-setup.sh"* ]]
}

@test "fork-export: missing upstream branch reports the configured branch" {
    _setup_fork_export_fixture
    printf '[fork]\nupstream_repo=%s\nupstream_branch=missing\n' "$FORK_FIXTURE_UPSTREAM" > "$DEVENV_ROOT/devenv.config"

    run bash "$SCRIPT"
    [ "$status" -ne 0 ]
    [[ "$output" == *"upstream branch 'missing' was not fetched"* ]]
}

@test "fork-export: invalid end ref is rejected before export" {
    _setup_fork_export_fixture

    run bash "$SCRIPT" missing-end-ref
    [ "$status" -ne 0 ]
    [[ "$output" == *"does not resolve to a commit"* ]]
}

@test "fork-export: rejects an end commit with no upstream history" {
    _setup_fork_export_fixture
    empty_tree="$(git mktree </dev/null)"
    unrelated_commit="$(printf 'Unrelated root\n' | git commit-tree "$empty_tree")"

    run bash "$SCRIPT" "$unrelated_commit"
    [ "$status" -ne 0 ]
    [[ "$output" == *"have no common history"* ]]
}

@test "fork-export: default bundle contains commits from upstream base to HEAD" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"
    _add_export_commit "Local two"

    run bash "$SCRIPT"
    [ "$status" -eq 0 ]
    bundle_file="$(sed -n 's/^Bundle: //p' <<< "$output")"
    [ -f "$bundle_file" ]
    git bundle verify "$bundle_file"
    bundle_heads="$(git bundle list-heads "$bundle_file")"
    [[ "$bundle_heads" == *"$(git rev-parse HEAD)"* ]]
    [ -z "$(git for-each-ref --format='%(refname)' refs/fork-export)" ]
}

@test "fork-export: explicit end ref stops the range at that commit" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"
    first_commit="$(git rev-parse HEAD)"
    _add_export_commit "Local two"

    run bash "$SCRIPT" "$first_commit" --format bundle
    [ "$status" -eq 0 ]
    bundle_file="$(sed -n 's/^Bundle: //p' <<< "$output")"
    [ -f "$bundle_file" ]
    bundle_heads="$(git bundle list-heads "$bundle_file")"
    [[ "$bundle_heads" == *"$first_commit"* ]]
    [[ "$bundle_heads" != *"$(git rev-parse HEAD)"* ]]
}

@test "fork-export: resolves an upstream tracking end ref after fetch" {
    _setup_fork_export_fixture
    git -C "$FORK_FIXTURE_GH_CLONE" checkout -qb feature
    printf 'feature one\n' > "$FORK_FIXTURE_GH_CLONE/feature.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add feature.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Feature commit one"
    printf 'feature two\n' >> "$FORK_FIXTURE_GH_CLONE/feature.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add feature.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "Feature commit two"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin feature:feature
    base="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse refs/remotes/upstream/master)"
    git -C "$FORK_FIXTURE_WORKING_CLONE" update-ref refs/remotes/upstream/feature "$base"
    feature_tip="$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse HEAD)"

    run bash "$SCRIPT" upstream/feature --format bundle
    [ "$status" -eq 0 ]
    bundle_file="$(sed -n 's/^Bundle: //p' <<< "$output")"
    bundle_heads="$(git -C "$FORK_FIXTURE_WORKING_CLONE" bundle list-heads "$bundle_file")"
    [[ "$bundle_heads" == *"$feature_tip"* ]]
    [[ "$output" == *"Commits: 2"* ]]
}

@test "fork-export: patch series applies to the sibling clone" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"
    _add_export_commit "Local two"

    run bash "$SCRIPT" --format patch
    [ "$status" -eq 0 ]
    patch_dir="$(sed -n 's/^Patches: //p' <<< "$output")"
    patch_files=("$patch_dir"/*.patch)
    [ "${#patch_files[@]}" -eq 2 ]
    git -C "$FORK_FIXTURE_GH_CLONE" am "${patch_files[@]}"
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%s)" = "Local two" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -2 --format=%s | tail -1)" = "Local one" ]
}

@test "fork-export: both format writes a bundle and patch series" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"

    run bash "$SCRIPT" --format both
    [ "$status" -eq 0 ]
    bundle_file="$(sed -n 's/^Bundle: //p' <<< "$output")"
    patch_dir="$(sed -n 's/^Patches: //p' <<< "$output")"
    [ -f "$bundle_file" ]
    [ -n "$(find "$patch_dir" -maxdepth 1 -name '*.patch' -print -quit)" ]
}

@test "fork-export: --apply-to applies the bundle into a sibling clone" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"

    run bash "$SCRIPT" --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -eq 0 ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%s)" = "Local one" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" show HEAD:changes.txt)" = "Local one" ]
    [[ "$output" != *"Bundle:"* ]]
}

@test "fork-export: bundle applies to a sibling clone advanced beyond the base" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"
    printf 'upstream advance\n' > "$FORK_FIXTURE_GH_CLONE/upstream-change.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add upstream-change.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "Target advance"

    run bash "$SCRIPT" --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -eq 0 ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%s)" = "Local one" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -2 --format=%s | tail -1)" = "Target advance" ]
    [ -f "$FORK_FIXTURE_GH_CLONE/upstream-change.txt" ]
}

@test "fork-export: --apply-to applies a patch series into a sibling clone" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"

    run bash "$SCRIPT" --format patch --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -eq 0 ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%s)" = "Local one" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" show HEAD:changes.txt)" = "Local one" ]
}

@test "fork-export: rejects a non-repository --apply-to target" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"

    run bash "$SCRIPT" --apply-to "$TEST_TEMP_DIR/not-a-repository"
    [ "$status" -ne 0 ]
    [[ "$output" == *"not a git repository"* ]]
}

@test "fork-export: rejects an unrelated --apply-to repository" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"
    unrelated="$TEST_TEMP_DIR/unrelated-repository"
    git init -q -b master "$unrelated"
    git -C "$unrelated" config user.email test@example.com
    git -C "$unrelated" config user.name Test
    printf 'unrelated\n' > "$unrelated/README.md"
    git -C "$unrelated" add README.md
    git -C "$unrelated" commit -q -m unrelated

    run bash "$SCRIPT" --apply-to "$unrelated"
    [ "$status" -ne 0 ]
    [[ "$output" == *"does not descend from the upstream merge-base"* ]]
}

@test "fork-export: --dry-run writes no bundle and creates no temporary ref" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"

    run bash "$SCRIPT" --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"dry run"* ]]
    [ -z "$(find "$FORK_FIXTURE_WORKING_CLONE/.local-artifacts" -type f -print -quit 2>/dev/null)" ]
    [ -z "$(git for-each-ref --format='%(refname)' refs/fork-export)" ]
}

@test "fork-export: rejects an unknown format" {
    _setup_fork_export_fixture

    run bash "$SCRIPT" --format zip
    [ "$status" -ne 0 ]
    [[ "$output" == *"choose bundle, patch, or both"* ]]
}
