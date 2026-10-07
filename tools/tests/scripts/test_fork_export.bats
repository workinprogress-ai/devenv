#!/usr/bin/env bats
# Tests for scripts/fork-export.sh — export commits for transfer
# into a real GitHub clone.
#
# Contract tests for exporting commits into a real GitHub clone.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    SCRIPT="$DEVENV_TOOLS/scripts/fork-export.sh"
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

_install_fzf_stub() {
    mkdir -p "$TEST_TEMP_DIR/bin"
    cat > "$TEST_TEMP_DIR/bin/fzf" <<'STUB'
#!/usr/bin/env bash
prompt=""
for argument in "$@"; do
    case "$argument" in
        --prompt=*) prompt="${argument#--prompt=}" ;;
    esac
done
case "$prompt" in
    *"Start commit"*) selected="$FORK_EXPORT_START_SELECTION" ;;
    *"End commit"*) selected="$FORK_EXPORT_END_SELECTION" ;;
    *) exit 90 ;;
esac
printf '%s\n' "$prompt" >> "$FORK_EXPORT_FZF_LOG"
while IFS= read -r row; do
    [ -z "${FORK_EXPORT_FZF_INPUT_LOG:-}" ] || printf '%s\t%s\n' "$prompt" "$row" >> "$FORK_EXPORT_FZF_INPUT_LOG"
    [ "${row%%$'\t'*}" = "$selected" ] || continue
    printf '%s\n' "$row"
    exit 0
done
exit 1
STUB
    chmod +x "$TEST_TEMP_DIR/bin/fzf"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
}

_add_upstream_clone_to_repos() {
    mkdir -p "$FORK_FIXTURE_WORKING_CLONE/repos"
    ln -s "$FORK_FIXTURE_GH_CLONE" "$FORK_FIXTURE_WORKING_CLONE/repos/original"
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
    [[ "$output" == *"--start-ref <start-commit> <end-ref>"* ]]
    [[ "$output" == *"--all"* ]]
    [[ "$output" == *".local-artifacts/fork-export/<range-slug>/"* ]]
    [[ "$output" == *"--dry-run"* ]]
    [[ "$output" == *"waits for conflicts to be"* ]]
    [[ "$output" == *"resolved and staged"* ]]
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

    run bash -c "cd '$FORK_FIXTURE_WORKING_CLONE' && bash '$SCRIPT'"
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

    run bash "$SCRIPT" --all
    [ "$status" -eq 0 ]
    bundle_file="$(sed -n 's/^Bundle: //p' <<< "$output")"
    [ -f "$bundle_file" ]
    [[ "$output" == *"no matching clone found in repos/"* ]]
    git bundle verify "$bundle_file"
    bundle_heads="$(git bundle list-heads "$bundle_file")"
    [[ "$bundle_heads" == *"$(git rev-parse HEAD)"* ]]
    [ -z "$(git for-each-ref --format='%(refname)' refs/fork-export)" ]
}

@test "fork-export: auto-detects unique upstream clone under repos" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"
    _add_upstream_clone_to_repos

    run bash "$SCRIPT" --all
    [ "$status" -eq 0 ]
    [[ "$output" == *"detected upstream clone: $FORK_FIXTURE_GH_CLONE"* ]]
    [[ "$output" == *"Applied bundle to $FORK_FIXTURE_GH_CLONE"* ]]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%s)" = "Local one" ]
}

@test "fork-export: ambiguous upstream clones require explicit --apply-to" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"
    _add_upstream_clone_to_repos
    git clone -q "$FORK_FIXTURE_UPSTREAM" "$FORK_FIXTURE_WORKING_CLONE/repos/second"

    run bash "$SCRIPT" --all
    [ "$status" -ne 0 ]
    [[ "$output" == *"multiple repos/ clones match"* ]]
    [[ "$output" == *"--apply-to <path>"* ]]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse HEAD)" = "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse origin/master)" ]
}

@test "fork-export: --export-only bypasses a matching clone and writes bundle" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"
    _add_upstream_clone_to_repos

    run bash "$SCRIPT" --all --export-only
    [ "$status" -eq 0 ]
    [[ "$output" == *"Bundle:"* ]]
    [[ "$output" != *"detected upstream clone"* ]]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse HEAD)" = "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse origin/master)" ]
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

@test "fork-export: explicit inclusive start and end refs export only that range" {
    _setup_fork_export_fixture
    for commit in one two three; do
        printf '%s\n' "$commit" > "$FORK_FIXTURE_WORKING_CLONE/$commit.txt"
        git -C "$FORK_FIXTURE_WORKING_CLONE" add "$commit.txt"
        git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "Commit $commit"
        case "$commit" in
            two) start_ref="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" ;;
            three) end_ref="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" ;;
        esac
    done

    run bash "$SCRIPT" --start-ref "$start_ref" "$end_ref" --format bundle
    [ "$status" -eq 0 ]
    [[ "$output" == *"Commits: 2"* ]]
    bundle_file="$(sed -n 's/^Bundle: //p' <<< "$output")"
    bundle_heads="$(git -C "$FORK_FIXTURE_WORKING_CLONE" bundle list-heads "$bundle_file")"
    [[ "$bundle_heads" == *"$end_ref"* ]]
    ! git -C "$FORK_FIXTURE_WORKING_CLONE" bundle verify "$bundle_file" 2>&1 | grep -q "$start_ref"
}

@test "fork-export: interactive fzf range applies the selected inclusive commits after confirmation" {
    _setup_fork_export_fixture
    for commit in one two three; do
        printf '%s\n' "$commit" > "$FORK_FIXTURE_WORKING_CLONE/$commit.txt"
        git -C "$FORK_FIXTURE_WORKING_CLONE" add "$commit.txt"
        git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "Commit $commit"
        case "$commit" in
            one) first_ref="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" ;;
            two) start_ref="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" ;;
            three) end_ref="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" ;;
        esac
    done
    _install_fzf_stub
    export FORK_EXPORT_FZF_LOG="$TEST_TEMP_DIR/fzf-prompts.log"
    export FORK_EXPORT_START_SELECTION="$start_ref"
    export FORK_EXPORT_END_SELECTION="$end_ref"

    run bash -c "printf 'y\\n' | script -qfec \"bash '$SCRIPT' --apply-to '$FORK_FIXTURE_GH_CLONE'\" /dev/null"
    [ "$status" -eq 0 ]
    [ "$(wc -l < "$FORK_EXPORT_FZF_LOG")" -eq 2 ]
    grep -q 'Start commit (inclusive)' "$FORK_EXPORT_FZF_LOG"
    grep -q 'End commit (inclusive)' "$FORK_EXPORT_FZF_LOG"
    [[ "$output" == *"Selected range (2 commit(s))"* ]]
    [ ! -e "$FORK_FIXTURE_GH_CLONE/one.txt" ]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/two.txt")" = "two" ]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/three.txt")" = "three" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%s)" = "Commit three" ]
    [ "$first_ref" != "$start_ref" ]
}

@test "fork-export: excludes patch-equivalent commits already present in the target" {
    _setup_fork_export_fixture
    for commit in one two three; do
        printf '%s\n' "$commit" > "$FORK_FIXTURE_WORKING_CLONE/$commit.txt"
        git -C "$FORK_FIXTURE_WORKING_CLONE" add "$commit.txt"
        git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "Commit $commit"
        case "$commit" in
            one) already_present_ref="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" ;;
            two) start_ref="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" ;;
            three) end_ref="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" ;;
        esac
    done
    printf 'one\n' > "$FORK_FIXTURE_GH_CLONE/one.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add one.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "Equivalent patch with different hash"
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse HEAD)" != "$already_present_ref" ]

    _add_upstream_clone_to_repos
    _install_fzf_stub
    export FORK_EXPORT_FZF_LOG="$TEST_TEMP_DIR/fzf-prompts.log"
    export FORK_EXPORT_FZF_INPUT_LOG="$TEST_TEMP_DIR/fzf-input.log"
    export FORK_EXPORT_START_SELECTION="$start_ref"
    export FORK_EXPORT_END_SELECTION="$end_ref"

    run bash -c "printf 'y\\n' | script -qfec \"bash '$SCRIPT' --apply-to '$FORK_FIXTURE_GH_CLONE'\" /dev/null"
    [ "$status" -eq 0 ]
    [ "$(grep -c "$already_present_ref" "$FORK_EXPORT_FZF_INPUT_LOG" || true)" -eq 0 ]
    [[ "$output" == *"excluded 1 commit(s) already present in target"* ]] || {
        echo "export output: $output" >&2
        git -C "$FORK_FIXTURE_WORKING_CLONE" cherry -v "$FORK_FIXTURE_GH_CLONE" "$end_ref" "$(git -C "$FORK_FIXTURE_WORKING_CLONE" merge-base refs/remotes/upstream/master "$end_ref")" >&2
        return 1
    }
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%s | grep -c '^Equivalent patch with different hash$')" -eq 1 ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%s)" = "Commit three" ]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/two.txt")" = "two" ]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/three.txt")" = "three" ]
}

@test "fork-export: interactive picker cancellation leaves target untouched" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"
    _install_fzf_stub
    export FORK_EXPORT_START_SELECTION=cancel

    run script -qfec "bash '$SCRIPT' --apply-to '$FORK_FIXTURE_GH_CLONE'" /dev/null
    [ "$status" -ne 0 ]
    [[ "$output" == *"commit range selection cancelled"* ]]
    [ -z "$(git -C "$FORK_FIXTURE_GH_CLONE" status --porcelain)" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse HEAD)" = "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse origin/master)" ]
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

    run bash "$SCRIPT" --all --format patch
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

    run bash "$SCRIPT" --all --format both
    [ "$status" -eq 0 ]
    bundle_file="$(sed -n 's/^Bundle: //p' <<< "$output")"
    patch_dir="$(sed -n 's/^Patches: //p' <<< "$output")"
    [ -f "$bundle_file" ]
    [ -n "$(find "$patch_dir" -maxdepth 1 -name '*.patch' -print -quit)" ]
}

@test "fork-export: --apply-to applies the bundle into a sibling clone" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"
    _add_export_commit "Local two"

    run bash "$SCRIPT" --all --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -eq 0 ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%s)" = "Local two" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -2 --format=%s | tail -1)" = "Local one" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" show HEAD:changes.txt)" = $'Local one\nLocal two' ]
    [ -z "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse --verify --quiet CHERRY_PICK_HEAD)" ]
    [[ "$output" == *"cherry-pick sequence finalized"* ]]
    [[ "$output" != *"Bundle:"* ]]
}

@test "fork-export: non-interactive bundle conflict preserves sequencer and prints continuation guidance" {
    _setup_fork_export_fixture
    printf 'source version\n' > "$FORK_FIXTURE_WORKING_CLONE/README.md"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add README.md
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "Source edit"
    printf 'target version\n' > "$FORK_FIXTURE_GH_CLONE/README.md"
    git -C "$FORK_FIXTURE_GH_CLONE" add README.md
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "Target edit"

    run bash "$SCRIPT" --all --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -ne 0 ]
    [[ "$output" == *"cherry-pick conflict"* ]]
    [[ "$output" == *"git -C $FORK_FIXTURE_GH_CLONE cherry-pick --continue"* ]]
    git -C "$FORK_FIXTURE_GH_CLONE" rev-parse --verify --quiet CHERRY_PICK_HEAD
    [ -n "$(git -C "$FORK_FIXTURE_GH_CLONE" diff --name-only --diff-filter=U)" ]
}

@test "fork-export: non-interactive patch conflict preserves am state and prints continuation guidance" {
    _setup_fork_export_fixture
    printf 'source version\n' > "$FORK_FIXTURE_WORKING_CLONE/README.md"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add README.md
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "Source edit"
    printf 'target version\n' > "$FORK_FIXTURE_GH_CLONE/README.md"
    git -C "$FORK_FIXTURE_GH_CLONE" add README.md
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "Target edit"

    run bash "$SCRIPT" --all --format patch --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -ne 0 ]
    [[ "$output" == *"am conflict"* ]]
    [[ "$output" == *"git -C $FORK_FIXTURE_GH_CLONE am --continue"* ]]
    am_state="$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse --absolute-git-dir)/rebase-apply"
    [ -d "$am_state" ]
}

@test "fork-export: interactive bundle conflict waits and continues the queued sequence" {
    _setup_fork_export_fixture
    printf 'source version\n' > "$FORK_FIXTURE_WORKING_CLONE/README.md"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add README.md
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "Source edit"
    _add_export_commit "Source follow-up"
    printf 'target version\n' > "$FORK_FIXTURE_GH_CLONE/README.md"
    git -C "$FORK_FIXTURE_GH_CLONE" add README.md
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "Target edit"

    coproc EXPORTER { script -qfec "bash '$SCRIPT' --all --apply-to '$FORK_FIXTURE_GH_CLONE'" /dev/null; }
    local exporter_pid="$EXPORTER_PID"
    local line prompt_seen=0 output=""
    while IFS= read -r line <&"${EXPORTER[0]}"; do
        output+="$line"$'\n'
        if [[ "$line" == *"Resolve and stage these files"* ]]; then
            prompt_seen=1
            break
        fi
    done
    [ "$prompt_seen" -eq 1 ]
    [ -n "$(git -C "$FORK_FIXTURE_GH_CLONE" diff --name-only --diff-filter=U)" ]

    printf 'resolved version\n' > "$FORK_FIXTURE_GH_CLONE/README.md"
    git -C "$FORK_FIXTURE_GH_CLONE" add README.md
    printf '\n' >&"${EXPORTER[1]}"

    while IFS= read -r line <&"${EXPORTER[0]}"; do
        output+="$line"$'\n'
    done
    local exporter_status=0
    wait "$exporter_pid" || exporter_status=$?
    [ "$exporter_status" -eq 0 ]
    [[ "$output" == *"cherry-pick sequence finalized"* ]]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%s)" = "Source follow-up" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -2 --format=%s | tail -1)" = "Source edit" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" show HEAD:README.md)" = "resolved version" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" show HEAD:changes.txt)" = "Source follow-up" ]
    ! git -C "$FORK_FIXTURE_GH_CLONE" rev-parse --verify --quiet CHERRY_PICK_HEAD
}

@test "fork-export: bundle applies to a sibling clone advanced beyond the base" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"
    printf 'upstream advance\n' > "$FORK_FIXTURE_GH_CLONE/upstream-change.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add upstream-change.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "Target advance"

    run bash "$SCRIPT" --all --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -eq 0 ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%s)" = "Local one" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -2 --format=%s | tail -1)" = "Target advance" ]
    [ -f "$FORK_FIXTURE_GH_CLONE/upstream-change.txt" ]
}

@test "fork-export: --apply-to applies a patch series into a sibling clone" {
    _setup_fork_export_fixture
    _add_export_commit "Local one"

    run bash "$SCRIPT" --all --format patch --apply-to "$FORK_FIXTURE_GH_CLONE"
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

    run bash "$SCRIPT" --all --apply-to "$unrelated"
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

@test "fork-export: refuses a range that contains a merge commit and names it" {
    _setup_fork_export_fixture
    _add_export_commit "first"
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -q -b side
    printf 'side\n' > "$FORK_FIXTURE_WORKING_CLONE/side.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add side.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "side work"
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -q master
    _add_export_commit "second"
    git -C "$FORK_FIXTURE_WORKING_CLONE" merge -q --no-ff -m "merge side" side

    run bash "$SCRIPT" --all --export-only --format patch
    [ "$status" -ne 0 ]
    [[ "$output" == *"merge commit"* ]]
    [[ "$output" == *"merge side"* ]]
    [[ "$output" == *"fork-sync --rebase"* ]]
}

@test "fork-export: a linear range is not refused" {
    _setup_fork_export_fixture
    _add_export_commit "first"
    run bash "$SCRIPT" --all --export-only --format patch
    [ "$status" -eq 0 ]
    [[ "$output" != *"merge commit"* ]]
}

@test "fork-export: patch mode applies with git am -3 so context drift falls back to a three-way merge" {
    grep -q 'am -3 "\${PATCH_FILES\[@\]}"' "$SCRIPT"
    _setup_fork_export_fixture
    # The target clone's file differs in context from the fork's: plain git am would fail.
    printf 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\n' > "$FORK_FIXTURE_GH_CLONE/ctx.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add ctx.txt && git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "ctx base"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin HEAD:master
    git -C "$FORK_FIXTURE_WORKING_CLONE" fetch -q upstream
    git -C "$FORK_FIXTURE_WORKING_CLONE" merge -q --ff-only upstream/master
    printf 'l1\nl2\nl3\nl4\nl5\nL6-fork\nl7\nl8\nl9\n' > "$FORK_FIXTURE_WORKING_CLONE/ctx.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qam "fork edit l6"
    # In the target, a line inside the patch's context changed (l3), l6 itself untouched.
    printf 'l1\nl2\nX3\nl4\nl5\nl6\nl7\nl8\nl9\n' > "$FORK_FIXTURE_GH_CLONE/ctx.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qam "target drift"
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin HEAD:master
    run bash "$SCRIPT" --all --format patch --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -eq 0 ]
    grep -q 'L6-fork' "$FORK_FIXTURE_GH_CLONE/ctx.txt"
}

@test "fork-export: a start after the merge commit exports the linear tail; a start before it is refused" {
    _setup_fork_export_fixture
    _add_export_commit "first"
    local first
    first="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)"
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -q -b side
    printf 'side\n' > "$FORK_FIXTURE_WORKING_CLONE/side.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add side.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "side work"
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -q master
    _add_export_commit "second"
    git -C "$FORK_FIXTURE_WORKING_CLONE" merge -q --no-ff -m "merge side" side
    _add_export_commit "after the merge"
    local tail
    tail="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)"

    run bash "$SCRIPT" --start-ref "$tail" HEAD --export-only --format patch
    [ "$status" -eq 0 ]
    [[ "$output" != *"merge commit"* ]]

    run bash "$SCRIPT" --start-ref "$first" HEAD --export-only --format patch
    [ "$status" -ne 0 ]
    [[ "$output" == *"merge side"* ]]
}

@test "fork-export --dry-run: a merge in the range is refused when the range is fixed, but not when the picker will choose it" {
    _setup_fork_export_fixture
    _add_export_commit "first"
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -q -b side
    printf 'side\n' > "$FORK_FIXTURE_WORKING_CLONE/side.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add side.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "side work"
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -q master
    _add_export_commit "second"
    git -C "$FORK_FIXTURE_WORKING_CLONE" merge -q --no-ff -m "merge side" side

    # no TTY: the whole range is exported, so the dry run refuses like the real run
    run bash "$SCRIPT" --dry-run
    [ "$status" -ne 0 ]
    [[ "$output" == *"merge commit"* ]]

    # a TTY with no refs: the picker narrows the range, so the dry run does not refuse
    command -v script >/dev/null || skip "script(1) not available to provide a TTY"
    run script -qec "bash '$SCRIPT' --dry-run" /dev/null
    [[ "$output" != *"merge commit"* ]]
}
