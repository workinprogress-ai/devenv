#!/usr/bin/env bats
# tools/scripts/git-update: the real script's classification states, driven in
# throwaway repos. Phase-1 tests pin CURRENT observable behavior (the diverged
# state exits 1 with manual-intervention guidance); the rewritten-master work
# changes some of these locks deliberately and updates them in the same pass.

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPT="$BATS_TEST_DIRNAME/../../git-update"

setup() {
    test_helper_setup
    export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test
    export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test
    ORIGIN="$TEST_TEMP_DIR/origin.git"
    CLONE="$TEST_TEMP_DIR/clone"
    git init -q --bare -b master "$ORIGIN"
    git clone -q "$ORIGIN" "$CLONE"
    git -C "$CLONE" commit -q --allow-empty -m "base"
    git -C "$CLONE" push -q origin master
}

teardown() {
    test_helper_teardown
}

# advance_origin <message>: commit on a second clone and push, so the first
# clone's origin/master moves strictly ahead of it.
advance_origin() {
    local other="$TEST_TEMP_DIR/other"
    if [ ! -d "$other" ]; then
        git clone -q "$ORIGIN" "$other"
    fi
    git -C "$other" commit -q --allow-empty -m "$1"
    git -C "$other" push -q origin master
}

@test "git-update: --help prints usage without touching the repo" {
    cd "$CLONE"
    run "$SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage: git-update"* ]]
}

@test "git-update: unknown argument is refused" {
    cd "$CLONE"
    run "$SCRIPT" --frobnicate
    [ "$status" -eq 2 ]
}

@test "git-update: up to date reports so and exits 0" {
    cd "$CLONE"
    run "$SCRIPT"
    [ "$status" -eq 0 ]
    [[ "$output" == *"up to date"* ]]
}

@test "git-update: strictly behind pulls and exits 0" {
    advance_origin "new upstream commit"
    cd "$CLONE"
    run "$SCRIPT"
    [ "$status" -eq 0 ]
    [ "$(git -C "$CLONE" rev-parse HEAD)" = "$(git -C "$CLONE" rev-parse origin/master)" ]
}

@test "git-update: ahead of remote refuses with push guidance" {
    git -C "$CLONE" commit -q --allow-empty -m "local work"
    cd "$CLONE"
    run "$SCRIPT"
    [ "$status" -eq 1 ]
    [[ "$output" == *"ahead of the remote"* ]]
}

@test "git-update: diverged refuses with manual-intervention guidance" {
    advance_origin "new upstream commit"
    git -C "$CLONE" commit -q --allow-empty -m "local work"
    cd "$CLONE"
    run "$SCRIPT"
    [ "$status" -eq 1 ]
    [[ "$output" == *"diverged"* ]]
    [[ "$output" == *"Manual intervention"* ]]
    # Nothing was pulled or merged: local HEAD unchanged.
    [ "$(git -C "$CLONE" rev-parse master)" != "$(git -C "$CLONE" rev-parse origin/master)" ]
}

# ── Rewritten-origin fixture ────────────────────────────────────────────────
# A fork-sync replay + force-push shape: origin/master is rewritten so the
# clone's HEAD (a former origin tip) is NO LONGER reachable from the new
# origin/master. After a fetch, the client-side reflog of origin/master holds
# the pre-rewrite tip — the detection the update flow depends on.

# rewrite_origin: on a second clone, amend the tip (changing history), then
# force-push. Leaves $OLD_TIP (the pre-rewrite origin/master as the first
# clone knew it) and fetches in the first clone.
OLD_TIP=""
rewrite_origin() {
    local other="$TEST_TEMP_DIR/rewriter"
    if [ ! -d "$other" ]; then
        git clone -q "$ORIGIN" "$other"
    fi
    OLD_TIP="$(git -C "$other" rev-parse origin/master)"
    git -C "$other" commit -q --allow-empty --amend -m "rewritten base"
    git -C "$other" push -q --force origin master
    git -C "$CLONE" fetch -q origin
}

@test "fixture: reflog of origin/master records the pre-rewrite tip after a force-push" {
    rewrite_origin
    # The clone is still on the pre-rewrite commit; origin/master moved.
    [ "$(git -C "$CLONE" rev-parse master)" = "$OLD_TIP" ]
    [ "$(git -C "$CLONE" rev-parse origin/master)" != "$OLD_TIP" ]
    # The client-side reflog of the remote-tracking ref holds the old tip.
    grep -q "$OLD_TIP" < <(git -C "$CLONE" reflog show --format=%H origin/master)
}

@test "fixture: local HEAD is a past origin/master tip — the reset-safety proof" {
    # Local HEAD equals a reflog-recorded past remote tip: nothing unique to lose.
    rewrite_origin
    local found=0 tip
    while IFS= read -r tip; do
        [ "$tip" = "$(git -C "$CLONE" rev-parse master)" ] && found=1
    done < <(git -C "$CLONE" reflog show --format=%H origin/master | head -n 50)
    [ "$found" -eq 1 ]
}

@test "fixture: local commit on top of the old tip — NOT a past remote tip" {
    # A consumer with unique work: their HEAD is a child of the old tip, not a
    # recorded remote tip itself — the rebase path, never the reset path.
    rewrite_origin
    git -C "$CLONE" commit -q --allow-empty -m "consumer note"
    local found=0 tip
    while IFS= read -r tip; do
        [ "$tip" = "$(git -C "$CLONE" rev-parse master)" ] && found=1
    done < <(git -C "$CLONE" reflog show --format=%H origin/master | head -n 50)
    [ "$found" -eq 0 ]
}

@test "fixture: the check's reachability conditions identify the old tip as the base" {
    # Phase-1 probe for the lib contract (task 1.3): the exact conditions from
    # check-update-devenv-repo.sh's rewrite scan pick OLD_TIP out of the
    # reflog as "rewritten, and here is the pre-rewrite base".
    rewrite_origin
    local found=0 tip local_head
    local_head="$(git -C "$CLONE" rev-parse master)"
    while IFS= read -r tip; do
        [ -n "$tip" ] && [ "$tip" != "$(git -C "$CLONE" rev-parse origin/master)" ] || continue
        if git -C "$CLONE" merge-base --is-ancestor "$tip" "$local_head" 2>/dev/null \
            && ! git -C "$CLONE" merge-base --is-ancestor "$tip" "$(git -C "$CLONE" rev-parse origin/master)" 2>/dev/null \
            && git -C "$CLONE" cat-file -e "${tip}^{commit}" 2>/dev/null; then
            [ "$tip" = "$OLD_TIP" ] && found=1
            break
        fi
    done < <(git -C "$CLONE" reflog show --format=%H origin/master 2>/dev/null | head -n 50)
    [ "$found" -eq 1 ]
}

# ── Rewritten-path behavior (Phase 2) ──────────────────────────────────────

@test "git-update: rewritten remote + nothing unique resets to origin" {
    rewrite_origin
    cd "$CLONE"
    run "$SCRIPT"
    [ "$status" -eq 0 ]
    [ "$(git -C "$CLONE" rev-parse master)" = "$(git -C "$CLONE" rev-parse origin/master)" ]
    [[ "$output" == *"rewritten"* ]]
    [[ "$output" == *"Resetting"* ]]
}

@test "git-update: rewritten remote + unique local commits replays them via rebase" {
    rewrite_origin
    git -C "$CLONE" commit -q --allow-empty -m "consumer note"
    cd "$CLONE"
    run "$SCRIPT"
    [ "$status" -eq 0 ]
    # origin/master is fully contained in master (rebased ON TOP of it).
    git -C "$CLONE" merge-base --is-ancestor origin/master master
    [[ "$output" == *"replaying local commits"* ]]
    # The consumer's commit survived the replay.
    git -C "$CLONE" log --format=%s -2 | grep -q "consumer note"
}

@test "git-update: rewritten remote + dirty tree refuses before touching anything" {
    rewrite_origin
    printf 'uncommitted\n' > "$CLONE/dirty.txt"
    git -C "$CLONE" add dirty.txt
    cd "$CLONE"
    run "$SCRIPT"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Commit or discard"* ]]
    # Local HEAD unchanged: still on the pre-rewrite tip.
    [ "$(git -C "$CLONE" rev-parse master)" = "$OLD_TIP" ]
}

@test "git-update: rewritten remote + local merge commit refuses the auto-rebase" {
    rewrite_origin
    # A local merge commit on top of the old tip (octopus-free, two parents).
    git -C "$CLONE" checkout -q -b side "$OLD_TIP"
    git -C "$CLONE" commit -q --allow-empty -m "side work"
    git -C "$CLONE" checkout -q master
    git -C "$CLONE" commit -q --allow-empty -m "main work"
    git -C "$CLONE" merge -q --no-ff side -m "local merge"
    cd "$CLONE"
    run "$SCRIPT"
    [ "$status" -eq 1 ]
    [[ "$output" == *"merge commit"* ]]
    # Untouched: still on the local merge.
    [[ "$(git -C "$CLONE" log --format=%s -1)" == "local merge" ]]
}

@test "git-update: rebase conflict on rewritten remote aborts and leaves branch unchanged" {
    rewrite_origin
    # Give origin a FILE at a path the consumer also wrote locally: the rebase
    # of the local commit onto the rewritten history must conflict.
    git -C "$CLONE" commit -q --allow-empty -m "pre-conflict base"
    local other="$TEST_TEMP_DIR/conflictor"
    git clone -q "$ORIGIN" "$other"
    printf 'upstream version\n' > "$other/note.txt"
    git -C "$other" add note.txt
    git -C "$other" commit -q --amend --no-edit
    git -C "$other" push -q --force origin master
    # New OLD_TIP after this second rewrite, then the consumer builds on it.
    OLD_TIP="$(git -C "$other" rev-parse origin/master~1 2>/dev/null || echo "")"
    git -C "$CLONE" fetch -q origin
    printf 'local version\n' > "$CLONE/note.txt"
    git -C "$CLONE" add note.txt
    git -C "$CLONE" commit -q -m "local note"
    cd "$CLONE"
    run "$SCRIPT"
    [ "$status" -eq 1 ]
    [[ "$output" == *"aborted"* ]]
    [[ "$output" == *"git rebase --onto origin/master"* ]]
    # Repo is recoverable: no rebase in progress, branch back at its pre-run tip.
    [ ! -d "$CLONE/.git/rebase-merge" ] && [ ! -d "$CLONE/.git/rebase-apply" ]
    [[ "$(git -C "$CLONE" log --format=%s -1)" == "local note" ]]
}
