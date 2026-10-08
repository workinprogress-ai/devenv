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
    # Source commits get a Change-Id the way real ones do, through the hook.
    mkdir -p "$FORK_FIXTURE_WORKING_CLONE/.git/hooks"
    printf '#!/bin/sh\nexec bash "%s/scripts/prepare-commit-msg.sh" "$@"\n' "$DEVENV_TOOLS" > "$FORK_FIXTURE_WORKING_CLONE/.git/hooks/prepare-commit-msg"
    chmod +x "$FORK_FIXTURE_WORKING_CLONE/.git/hooks/prepare-commit-msg"
    cd "$FORK_FIXTURE_WORKING_CLONE"
}

_add_export_commit() {
    printf '%s\n' "$1" >> "$FORK_FIXTURE_WORKING_CLONE/changes.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add changes.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "$1"
}

# fzf stand-in. Each invocation consumes the next entry of FORK_EXPORT_PICKS
# (separated by ';'): "[key|]sha,sha". A missing entry cancels, like Escape.
_install_fzf_stub() {
    mkdir -p "$TEST_TEMP_DIR/bin"
    cat > "$TEST_TEMP_DIR/bin/fzf" <<'STUB'
#!/usr/bin/env bash
prompt=""
expect=""
for argument in "$@"; do
    case "$argument" in
        --prompt=*) prompt="${argument#--prompt=}" ;;
        --expect=*) expect="${argument#--expect=}" ;;
    esac
done
log="${FORK_EXPORT_FZF_LOG:-/dev/null}"
count_file="$TEST_TEMP_DIR/fzf-call-count"
call=$(( $(cat "$count_file" 2>/dev/null || echo 0) + 1 ))
printf '%s' "$call" > "$count_file"
printf '%s\n' "$prompt" >> "$log"
rows="$(cat)"
if [ -n "${FORK_EXPORT_FZF_INPUT_LOG:-}" ]; then
    while IFS= read -r row; do
        printf '%s\t%s\n' "$prompt" "$row"
    done <<< "$rows" >> "$FORK_EXPORT_FZF_INPUT_LOG"
fi
IFS=';' read -ra picks <<< "${FORK_EXPORT_PICKS:-}"
pick="${picks[$((call - 1))]:-}"
[ -n "$pick" ] || exit 130
key=""
shas="$pick"
case "$pick" in *'|'*) key="${pick%%|*}"; shas="${pick#*|}" ;; esac
[ -z "$expect" ] || printf '%s\n' "$key"
IFS=',' read -ra wanted <<< "$shas"
for sha in "${wanted[@]}"; do
    while IFS= read -r row; do
        if [ "${row%%$'\t'*}" = "$sha" ]; then printf '%s\n' "$row"; fi
    done <<< "$rows"
done
exit 0
STUB
    chmod +x "$TEST_TEMP_DIR/bin/fzf"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
    export TEST_TEMP_DIR
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

@test "fork-export: interactive multi-select exports the marked commits, contiguous or not, after confirmation" {
    _setup_fork_export_fixture
    for commit in one two three; do
        printf '%s\n' "$commit" > "$FORK_FIXTURE_WORKING_CLONE/$commit.txt"
        git -C "$FORK_FIXTURE_WORKING_CLONE" add "$commit.txt"
        git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "Commit $commit"
        case "$commit" in
            one) first_ref="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" ;;
            three) last_ref="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD)" ;;
        esac
    done
    _install_fzf_stub
    export FORK_EXPORT_FZF_LOG="$TEST_TEMP_DIR/fzf-prompts.log"
    export FORK_EXPORT_PICKS="$first_ref,$last_ref"

    # y confirms the export; the empty answer keeps the unselected commit in future exports
    run bash -c "printf 'y\\n\\n' | script -qfec \"bash '$SCRIPT' --apply-to '$FORK_FIXTURE_GH_CLONE'\" /dev/null"
    [ "$status" -eq 0 ]
    [ "$(wc -l < "$FORK_EXPORT_FZF_LOG")" -eq 1 ]
    grep -q 'Commits to export' "$FORK_EXPORT_FZF_LOG"
    [[ "$output" == *"Selected commits (2)"* ]]
    [[ "$output" == *"1 commit(s) were not selected"* ]]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/one.txt")" = "one" ]
    [ ! -e "$FORK_FIXTURE_GH_CLONE/two.txt" ]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/three.txt")" = "three" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%s)" = "Commit three" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%s | grep -c '^Commit two$')" -eq 0 ]
    run bash "$SCRIPT" --list-skipped
    [ "$output" = "no skipped commits" ]
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
    export FORK_EXPORT_PICKS="$start_ref,$end_ref"

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
    unset FORK_EXPORT_PICKS

    run script -qfec "bash '$SCRIPT' --apply-to '$FORK_FIXTURE_GH_CLONE'" /dev/null
    [ "$status" -ne 0 ]
    [[ "$output" == *"commit selection cancelled"* ]]
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

    run bash "$SCRIPT" upstream/feature --format bundle --include-untracked
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

_add_untracked_commit() {
    printf '%s\n' "$1" >> "$FORK_FIXTURE_WORKING_CLONE/changes.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add changes.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" -c core.hooksPath=/dev/null commit -q -m "$1"
}

# Commit a distinct file, with the hook (tracked) or without it (untracked).
# Usage: _add_file_commit NAME [untracked]
_add_file_commit() {
    printf '%s\n' "$1" > "$FORK_FIXTURE_WORKING_CLONE/$1.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add "$1.txt"
    if [ "${2:-}" = "untracked" ]; then
        git -C "$FORK_FIXTURE_WORKING_CLONE" -c core.hooksPath=/dev/null commit -q -m "Commit $1"
    else
        git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "Commit $1"
    fi
}

_head_of_source() {
    git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse HEAD
}

@test "fork-export: a commit without a Change-Id is hidden and counted; --include-untracked shows it" {
    _setup_fork_export_fixture
    _add_export_commit "Tracked one"
    _add_untracked_commit "Legacy two"

    run bash "$SCRIPT" --all --export-only
    [ "$status" -eq 0 ]
    [[ "$output" == *"1 commit(s) without a Change-Id hidden (--include-untracked shows them)"* ]]
    [[ "$output" == *"Commits: 1"* ]]

    run bash "$SCRIPT" --all --export-only --include-untracked
    [ "$status" -eq 0 ]
    [[ "$output" != *"hidden"* ]]
    [[ "$output" == *"Commits: 2"* ]]
}

@test "fork-export: refuses with an explanation when every candidate is hidden" {
    _setup_fork_export_fixture
    _add_untracked_commit "Legacy only"

    run bash "$SCRIPT" --all --export-only
    [ "$status" -ne 0 ]
    [[ "$output" == *"1 commit(s) without a Change-Id hidden"* ]]
    [[ "$output" == *"no exportable commits remain"* ]]
}

@test "fork-export: a Fork-Only commit is skipped; --include-skipped shows it" {
    _setup_fork_export_fixture
    _add_export_commit "Shared one"
    printf 'fork\n' > "$FORK_FIXTURE_WORKING_CLONE/fork.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add fork.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "Fork thing" -m "Fork-Only: yes"

    run bash "$SCRIPT" --all --export-only
    [ "$status" -eq 0 ]
    [[ "$output" == *"skipped 1 commit(s) marked Fork-Only or in the skip list"* ]]
    [[ "$output" == *"Commits: 1"* ]]

    run bash "$SCRIPT" --all --export-only --include-skipped
    [ "$status" -eq 0 ]
    [[ "$output" == *"Commits: 2"* ]]
}

@test "fork-export: skip-list entries by Change-Id and by SHA exclude commits" {
    _setup_fork_export_fixture
    source "$DEVENV_TOOLS/lib/change-id.bash"
    _add_export_commit "Keep"
    _add_export_commit "Skip by id"
    skip_list_add "$FORK_FIXTURE_WORKING_CLONE" change-id "$(change_id_get_from_commit "$FORK_FIXTURE_WORKING_CLONE" HEAD)"
    _add_export_commit "Skip by sha"
    skip_list_add "$FORK_FIXTURE_WORKING_CLONE" sha HEAD

    run bash "$SCRIPT" --all --export-only
    [ "$status" -eq 0 ]
    [[ "$output" == *"skipped 2 commit(s)"* ]]
    [[ "$output" == *"Commits: 1"* ]]

    run bash "$SCRIPT" --all --export-only --include-skipped
    [[ "$output" == *"Commits: 3"* ]]
}

@test "fork-export: a Change-Id already in the target excludes the commit even when the patch differs" {
    _setup_fork_export_fixture
    source "$DEVENV_TOOLS/lib/change-id.bash"
    _add_export_commit "Shared change"
    shared_id="$(change_id_get_from_commit "$FORK_FIXTURE_WORKING_CLONE" HEAD)"
    printf 'fresh\n' > "$FORK_FIXTURE_WORKING_CLONE/fresh.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add fresh.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "Fresh change"
    printf 'different\n' > "$FORK_FIXTURE_GH_CLONE/other.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add other.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "Reworked copy" -m "Change-Id: $shared_id"

    run bash "$SCRIPT" --all --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -eq 0 ]
    [[ "$output" == *"excluded 1 commit(s) already present in target by Change-Id"* ]]
    [[ "$output" == *"Commits: 1"* ]]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/fresh.txt")" = "fresh" ]
    [ ! -e "$FORK_FIXTURE_GH_CLONE/changes.txt" ]
}

@test "fork-export --dry-run: reports the same commit count the real run exports" {
    _setup_fork_export_fixture
    _add_export_commit "Tracked"
    _add_untracked_commit "Legacy"

    run bash "$SCRIPT" --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"would export 1 commit(s)"* ]]
    [[ "$output" == *"1 commit(s) without a Change-Id hidden"* ]]

    run bash "$SCRIPT" --all --export-only
    [[ "$output" == *"Commits: 1"* ]]
}

@test "fork-export: --skip, --list-skipped and --unskip manage the skip list" {
    _setup_fork_export_fixture
    _add_export_commit "One"
    sha="$(_head_of_source)"

    run bash "$SCRIPT" --skip "$sha"
    [ "$status" -eq 0 ]
    [[ "$output" == *"skipped"*"One"* ]]

    run bash "$SCRIPT" --list-skipped
    [ "$status" -eq 0 ]
    [[ "$output" == *"sha $sha"* ]]
    [[ "$output" == *"change-id "* ]]

    run bash "$SCRIPT" --all --export-only
    [ "$status" -ne 0 ]
    [[ "$output" == *"skipped 1 commit(s)"* ]]

    run bash "$SCRIPT" --unskip "$sha"
    [ "$status" -eq 0 ]
    run bash "$SCRIPT" --list-skipped
    [ "$output" = "no skipped commits" ]

    run bash "$SCRIPT" --all --export-only
    [ "$status" -eq 0 ]
    [[ "$output" == *"Commits: 1"* ]]
}

@test "fork-export: --skip rejects a non-commit and --unskip rejects an unlisted commit" {
    _setup_fork_export_fixture
    _add_export_commit "One"

    run bash "$SCRIPT" --skip not-a-commit
    [ "$status" -ne 0 ]
    [[ "$output" == *"not a commit"* ]]

    run bash "$SCRIPT" --unskip "$(_head_of_source)"
    [ "$status" -ne 0 ]
    [[ "$output" == *"no skip-list entry matches"* ]]
}

@test "fork-export: --skip with no commit opens a picker to choose which ones to skip" {
    _setup_fork_export_fixture
    _add_export_commit "One"
    one_sha="$(_head_of_source)"
    _add_export_commit "Two"
    two_sha="$(_head_of_source)"
    _install_fzf_stub
    export FORK_EXPORT_FZF_LOG="$TEST_TEMP_DIR/fzf-prompts.log"
    export FORK_EXPORT_PICKS="$one_sha"

    run bash -c "script -qfec \"bash '$SCRIPT' --skip\" /dev/null"
    [ "$status" -eq 0 ]
    grep -q 'Commits to skip for good' "$FORK_EXPORT_FZF_LOG"
    [[ "$output" == *"skipped 1 commit(s)"* ]]
    [[ "$output" == *"One"* ]]
    [[ "$output" != *"Two"* ]]

    run bash "$SCRIPT" --list-skipped
    [[ "$output" == *"sha $one_sha"* ]]
    [[ "$output" != *"$two_sha"* ]]

    run bash "$SCRIPT" --all --export-only
    [[ "$output" == *"Commits: 1"* ]]
}

@test "fork-export: --skip with no commit and no TTY requires an explicit commit" {
    _setup_fork_export_fixture
    _add_export_commit "One"

    run bash "$SCRIPT" --skip < /dev/null
    [ "$status" -ne 0 ]
    [[ "$output" == *"needs an explicit commit"* ]]
}

@test "fork-export: --list-skipped prunes an entry whose commit no longer exists" {
    _setup_fork_export_fixture
    source "$DEVENV_TOOLS/lib/change-id.bash"
    printf 'sha 0000000000000000000000000000000000000000 # gone\n' >> "$(skip_list_get_path "$FORK_FIXTURE_WORKING_CLONE")"

    run bash "$SCRIPT" --list-skipped
    [ "$status" -eq 0 ]
    [[ "$output" == *"pruned stale entry"* ]]
    [[ "$output" == *"no skipped commits"* ]]
}

@test "fork-export: a hidden commit makes the export a subset, so it cherry-picks instead of fast-forwarding" {
    _setup_fork_export_fixture
    _add_file_commit alpha
    _add_file_commit legacy untracked
    _add_file_commit beta

    run bash "$SCRIPT" --all --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -eq 0 ]
    [[ "$output" == *"cherry-pick sequence finalized"* ]]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/alpha.txt")" = "alpha" ]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/beta.txt")" = "beta" ]
    [ ! -e "$FORK_FIXTURE_GH_CLONE/legacy.txt" ]
}

@test "fork-export: the output directory of a subset export differs from the full range's" {
    _setup_fork_export_fixture
    _add_file_commit alpha
    _add_file_commit legacy untracked
    _add_file_commit beta

    run bash "$SCRIPT" --all --export-only
    [ "$status" -eq 0 ]
    subset_dir="$(sed -n 's/^Bundle: //p' <<< "$output")"
    [[ "$subset_dir" == *"-sel"* ]]

    run bash "$SCRIPT" --all --export-only --include-untracked
    [ "$status" -eq 0 ]
    full_dir="$(sed -n 's/^Bundle: //p' <<< "$output")"
    [[ "$full_dir" != *"-sel"* ]]
    [ "$(dirname "$subset_dir")" != "$(dirname "$full_dir")" ]
}

@test "fork-export: an explicit start commit that is not exportable is refused with the reason" {
    _setup_fork_export_fixture
    _add_file_commit legacy untracked
    legacy_sha="$(_head_of_source)"
    _add_file_commit beta

    run bash "$SCRIPT" --start-ref "$legacy_sha" HEAD --export-only
    [ "$status" -ne 0 ]
    [[ "$output" == *"the start commit is not exportable"* ]]
}

@test "fork-export: ctrl-x in the picker skips the marked commit for good and reopens the picker without it" {
    _setup_fork_export_fixture
    _add_file_commit one
    one_sha="$(_head_of_source)"
    _add_file_commit two
    two_sha="$(_head_of_source)"
    _add_file_commit three
    three_sha="$(_head_of_source)"
    _install_fzf_stub
    export FORK_EXPORT_FZF_LOG="$TEST_TEMP_DIR/fzf-prompts.log"
    export FORK_EXPORT_FZF_INPUT_LOG="$TEST_TEMP_DIR/fzf-input.log"
    export FORK_EXPORT_PICKS="ctrl-x|$two_sha;$one_sha,$three_sha"

    run bash -c "printf 'y\\n\\n' | script -qfec \"bash '$SCRIPT' --apply-to '$FORK_FIXTURE_GH_CLONE'\" /dev/null"
    [ "$status" -eq 0 ]
    [ "$(wc -l < "$FORK_EXPORT_FZF_LOG")" -eq 2 ]
    [[ "$output" == *"skipped 1 commit(s) for good"* ]]
    [ "$(grep -c "$two_sha" "$FORK_EXPORT_FZF_INPUT_LOG")" -eq 1 ]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/one.txt")" = "one" ]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/three.txt")" = "three" ]
    [ ! -e "$FORK_FIXTURE_GH_CLONE/two.txt" ]
    run bash "$SCRIPT" --list-skipped
    [[ "$output" == *"sha $two_sha"* ]]
    [[ "$output" != *"sha $one_sha"* ]]
}

@test "fork-export: after the export the unselected commits can all be excluded from future exports" {
    _setup_fork_export_fixture
    _add_file_commit one
    one_sha="$(_head_of_source)"
    _add_file_commit two
    two_sha="$(_head_of_source)"
    _add_file_commit three
    three_sha="$(_head_of_source)"
    _install_fzf_stub
    export FORK_EXPORT_PICKS="$one_sha"

    run bash -c "printf 'y\\na\\n' | script -qfec \"bash '$SCRIPT' --apply-to '$FORK_FIXTURE_GH_CLONE'\" /dev/null"
    [ "$status" -eq 0 ]
    [[ "$output" == *"excluded 2 commit(s) from future exports"* ]]
    run bash "$SCRIPT" --list-skipped
    [[ "$output" == *"sha $two_sha"* ]]
    [[ "$output" == *"sha $three_sha"* ]]
    [[ "$output" != *"sha $one_sha"* ]]
}

@test "fork-export: the unselected commits to exclude can be chosen" {
    _setup_fork_export_fixture
    _add_file_commit one
    one_sha="$(_head_of_source)"
    _add_file_commit two
    two_sha="$(_head_of_source)"
    _add_file_commit three
    three_sha="$(_head_of_source)"
    _install_fzf_stub
    export FORK_EXPORT_FZF_LOG="$TEST_TEMP_DIR/fzf-prompts.log"
    export FORK_EXPORT_PICKS="$one_sha;$two_sha"

    run bash -c "printf 'y\\nc\\n' | script -qfec \"bash '$SCRIPT' --apply-to '$FORK_FIXTURE_GH_CLONE'\" /dev/null"
    [ "$status" -eq 0 ]
    grep -q 'Commits to exclude for good' "$FORK_EXPORT_FZF_LOG"
    [[ "$output" == *"excluded 1 commit(s) from future exports"* ]]
    run bash "$SCRIPT" --list-skipped
    [[ "$output" == *"sha $two_sha"* ]]
    [[ "$output" != *"sha $three_sha"* ]]
}

@test "fork-export: declining the export records no exclusion" {
    _setup_fork_export_fixture
    _add_file_commit one
    one_sha="$(_head_of_source)"
    _add_file_commit two
    _install_fzf_stub
    export FORK_EXPORT_PICKS="$one_sha"

    run bash -c "printf 'n\\na\\n' | script -qfec \"bash '$SCRIPT' --apply-to '$FORK_FIXTURE_GH_CLONE'\" /dev/null"
    [ "$status" -ne 0 ]
    [[ "$output" == *"commit export cancelled"* ]]
    run bash "$SCRIPT" --list-skipped
    [ "$output" = "no skipped commits" ]
}

@test "fork-export: a multi-select export works in patch format too" {
    _setup_fork_export_fixture
    _add_file_commit one
    one_sha="$(_head_of_source)"
    _add_file_commit two
    _add_file_commit three
    three_sha="$(_head_of_source)"
    _install_fzf_stub
    export FORK_EXPORT_PICKS="$one_sha,$three_sha"

    run bash -c "printf 'y\\n\\n' | script -qfec \"bash '$SCRIPT' --format patch --apply-to '$FORK_FIXTURE_GH_CLONE'\" /dev/null"
    [ "$status" -eq 0 ]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/one.txt")" = "one" ]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/three.txt")" = "three" ]
    [ ! -e "$FORK_FIXTURE_GH_CLONE/two.txt" ]
}

@test "fork-export: an explicit-start export that filters a commit gets its own directory with no stale patches" {
    _setup_fork_export_fixture
    _add_file_commit one
    one_sha="$(_head_of_source)"
    printf 'fork\n' > "$FORK_FIXTURE_WORKING_CLONE/fork.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add fork.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "Fork thing" -m "Fork-Only: yes"
    _add_file_commit three

    run bash "$SCRIPT" --start-ref "$one_sha" HEAD --export-only --format patch --include-skipped
    [ "$status" -eq 0 ]
    all_dir="$(sed -n 's/^Patches: //p' <<< "$output")"
    [ "$(find "$all_dir" -name '*.patch' | wc -l)" -eq 3 ]

    run bash "$SCRIPT" --start-ref "$one_sha" HEAD --export-only --format patch
    [ "$status" -eq 0 ]
    filtered_dir="$(sed -n 's/^Patches: //p' <<< "$output")"
    [ "$filtered_dir" != "$all_dir" ]
    [ "$(find "$filtered_dir" -name '*.patch' | wc -l)" -eq 2 ]
    [ "$(grep -l 'Fork thing' "$filtered_dir"/*.patch | wc -l)" -eq 0 ]
}

@test "fork-export: duplicate Change-Ids in the range are reported and not matched against the target" {
    _setup_fork_export_fixture
    for name in first second; do
        printf '%s\n' "$name" > "$FORK_FIXTURE_WORKING_CLONE/$name.txt"
        git -C "$FORK_FIXTURE_WORKING_CLONE" add "$name.txt"
        git -C "$FORK_FIXTURE_WORKING_CLONE" commit -q -m "Commit $name" -m "Change-Id: Dup123Dup123"
        [ "$name" != "first" ] || first_sha="$(_head_of_source)"
    done

    run bash "$SCRIPT" "$first_sha" --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -eq 0 ]
    [ -f "$FORK_FIXTURE_GH_CLONE/first.txt" ]

    run bash "$SCRIPT" --all --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -eq 0 ]
    [[ "$output" == *"warning: Change-Id Dup123Dup123 is carried by 2 commits"* ]]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/second.txt")" = "second" ]
}

@test "fork-export: --unskip by Change-Id restores a commit skipped by --skip" {
    _setup_fork_export_fixture
    source "$DEVENV_TOOLS/lib/change-id.bash"
    _add_export_commit "One"
    id="$(change_id_get_from_commit "$FORK_FIXTURE_WORKING_CLONE" HEAD)"

    run bash "$SCRIPT" --skip HEAD
    [ "$status" -eq 0 ]
    run bash "$SCRIPT" --unskip "$id"
    [ "$status" -eq 0 ]
    run bash "$SCRIPT" --list-skipped
    [ "$output" = "no skipped commits" ]
    run bash "$SCRIPT" --all --export-only
    [ "$status" -eq 0 ]
    [[ "$output" == *"Commits: 1"* ]]
}

@test "fork-export: skip management is refused with --dry-run and leaves the list untouched" {
    _setup_fork_export_fixture
    _add_export_commit "One"

    run bash "$SCRIPT" --dry-run --skip HEAD
    [ "$status" -ne 0 ]
    [[ "$output" == *"--dry-run cannot be combined with --skip"* ]]
    run bash "$SCRIPT" --list-skipped
    [ "$output" = "no skipped commits" ]
    run bash "$SCRIPT" --dry-run --list-skipped
    [ "$status" -ne 0 ]
}

@test "fork-export --dry-run: counts the same commits as the real run when the target already has a Change-Id" {
    _setup_fork_export_fixture
    source "$DEVENV_TOOLS/lib/change-id.bash"
    _add_file_commit shared
    shared_id="$(change_id_get_from_commit "$FORK_FIXTURE_WORKING_CLONE" HEAD)"
    _add_file_commit fresh
    printf 'different\n' > "$FORK_FIXTURE_GH_CLONE/other.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add other.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q -m "Reworked copy" -m "Change-Id: $shared_id"

    run bash "$SCRIPT" --dry-run --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -eq 0 ]
    [[ "$output" == *"excluded 1 commit(s) already present in target by Change-Id"* ]]
    [[ "$output" == *"would export 1 commit(s)"* ]]

    run bash "$SCRIPT" --all --apply-to "$FORK_FIXTURE_GH_CLONE"
    [[ "$output" == *"Commits: 1"* ]]
}

@test "fork-export: ctrl-x with --include-skipped still removes the skipped row from the reopened picker" {
    _setup_fork_export_fixture
    _add_file_commit one
    one_sha="$(_head_of_source)"
    _add_file_commit two
    two_sha="$(_head_of_source)"
    _install_fzf_stub
    export FORK_EXPORT_FZF_LOG="$TEST_TEMP_DIR/fzf-prompts.log"
    export FORK_EXPORT_FZF_INPUT_LOG="$TEST_TEMP_DIR/fzf-input.log"
    export FORK_EXPORT_PICKS="ctrl-x|$two_sha;$one_sha"

    run bash -c "printf 'y\\n' | script -qfec \"bash '$SCRIPT' --include-skipped --apply-to '$FORK_FIXTURE_GH_CLONE'\" /dev/null"
    [ "$status" -eq 0 ]
    [ "$(grep -c "$two_sha" "$FORK_EXPORT_FZF_INPUT_LOG")" -eq 1 ]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/one.txt")" = "one" ]
    [ ! -e "$FORK_FIXTURE_GH_CLONE/two.txt" ]
}

@test "fork-export: a bundle ends at the newest exported commit, not at a hidden tip" {
    _setup_fork_export_fixture
    _add_file_commit alpha
    alpha_sha="$(_head_of_source)"
    _add_file_commit legacy untracked
    legacy_sha="$(_head_of_source)"

    run bash "$SCRIPT" --all --export-only --format bundle
    [ "$status" -eq 0 ]
    bundle_file="$(sed -n 's/^Bundle: //p' <<< "$output")"
    heads="$(git -C "$FORK_FIXTURE_WORKING_CLONE" bundle list-heads "$bundle_file")"
    [[ "$heads" == *"$alpha_sha"* ]]
    [[ "$heads" != *"$legacy_sha"* ]]
}

@test "fork-export: selected commits on diverging branches are all transported" {
    _setup_fork_export_fixture
    base_branch="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse --abbrev-ref HEAD)"
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -q -b side
    _add_file_commit side_one
    side_sha="$(_head_of_source)"
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -q "$base_branch"
    _add_file_commit main_one
    main_sha="$(_head_of_source)"
    git -C "$FORK_FIXTURE_WORKING_CLONE" merge -q --no-ff -m "merge side" side
    _install_fzf_stub
    export FORK_EXPORT_PICKS="$main_sha,$side_sha"

    run bash -c "printf 'y\\n' | script -qfec \"bash '$SCRIPT' --apply-to '$FORK_FIXTURE_GH_CLONE'\" /dev/null"
    [ "$status" -eq 0 ]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/main_one.txt")" = "main_one" ]
    [ "$(cat "$FORK_FIXTURE_GH_CLONE/side_one.txt")" = "side_one" ]
}

@test "fork-export: a failing target-history scan stops the export instead of reading as already present" {
    _setup_fork_export_fixture
    _add_file_commit alpha
    real_git="$(command -v git)"
    mkdir -p "$TEST_TEMP_DIR/shim"
    printf '%s\n' '#!/usr/bin/env bash' \
        'for argument in "$@"; do' \
        '    if [ "$argument" = "--not" ]; then echo "fatal: injected failure" >&2; exit 128; fi' \
        'done' \
        "exec $real_git \"\$@\"" > "$TEST_TEMP_DIR/shim/git"
    chmod +x "$TEST_TEMP_DIR/shim/git"

    run env PATH="$TEST_TEMP_DIR/shim:$PATH" bash "$SCRIPT" --all --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -ne 0 ]
    [[ "$output" == *"could not read the target's history"* ]]
    [ ! -e "$FORK_FIXTURE_GH_CLONE/alpha.txt" ]
}

# Put a git in front of PATH that fails one subcommand, optionally only when an argument equals ARG.
# Usage: _install_git_shim SUBCOMMAND [ARG]
_install_git_shim() {
    local real_git
    real_git="$(command -v git)"
    mkdir -p "$TEST_TEMP_DIR/shim"
    cat > "$TEST_TEMP_DIR/shim/git" <<SHIM
#!/usr/bin/env bash
sub=""
skip=0
for a in "\$@"; do
    if [ "\$skip" -eq 1 ]; then skip=0; continue; fi
    case "\$a" in -C) skip=1; continue ;; -*) continue ;; esac
    sub="\$a"; break
done
if [ "\$sub" = "$1" ]; then
    if [ -z "${2:-}" ]; then echo "fatal: injected failure" >&2; exit 128; fi
    for a in "\$@"; do
        if [ "\$a" = "${2:-}" ]; then echo "fatal: injected failure" >&2; exit 128; fi
    done
fi
exec $real_git "\$@"
SHIM
    chmod +x "$TEST_TEMP_DIR/shim/git"
}

@test "fork-export: a failing bundle-endpoint lookup stops the export and leaves no ref or target change" {
    _setup_fork_export_fixture
    _add_file_commit alpha
    _install_git_shim merge-base --independent

    run env PATH="$TEST_TEMP_DIR/shim:$PATH" bash "$SCRIPT" --all --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -ne 0 ]
    [[ "$output" == *"could not determine the bundle endpoints"* ]]
    [ -z "$(git -C "$FORK_FIXTURE_WORKING_CLONE" for-each-ref --format='%(refname)' refs/fork-export)" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse HEAD)" = "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse origin/master)" ]
}

@test "fork-export: a failing fetch of the bundle into the target cleans up and leaves the target alone" {
    _setup_fork_export_fixture
    _add_file_commit alpha
    _install_git_shim fetch --no-tags

    run env PATH="$TEST_TEMP_DIR/shim:$PATH" bash "$SCRIPT" --all --apply-to "$FORK_FIXTURE_GH_CLONE"
    [ "$status" -ne 0 ]
    [[ "$output" == *"failed to fetch the bundle into"* ]]
    [ -z "$(git -C "$FORK_FIXTURE_WORKING_CLONE" for-each-ref --format='%(refname)' refs/fork-export)" ]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse HEAD)" = "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse origin/master)" ]
}

@test "fork-export: a merge commit chosen in the picker is refused" {
    _setup_fork_export_fixture
    base_branch="$(git -C "$FORK_FIXTURE_WORKING_CLONE" rev-parse --abbrev-ref HEAD)"
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -q -b side
    _add_file_commit side_one
    git -C "$FORK_FIXTURE_WORKING_CLONE" checkout -q "$base_branch"
    _add_file_commit main_one
    git -C "$FORK_FIXTURE_WORKING_CLONE" merge -q --no-ff -m "merge side" side
    merge_sha="$(_head_of_source)"
    _install_fzf_stub
    export FORK_EXPORT_PICKS="$merge_sha"

    run bash -c "printf 'y\\n' | script -qfec \"bash '$SCRIPT' --include-untracked --apply-to '$FORK_FIXTURE_GH_CLONE'\" /dev/null"
    [ "$status" -ne 0 ]
    [[ "$output" == *"the selection contains merge commit(s)"* ]]
    [ "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse HEAD)" = "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse origin/master)" ]
}
