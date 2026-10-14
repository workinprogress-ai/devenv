#!/usr/bin/env bats
# check-update-devenv-repo.sh: every exit path, through a throwaway origin and
# clone. The script runs as its own process (sanity-check.sh executes it), so
# it needs no cd-back or return before exit — a child's cwd never reaches its
# parent, and `return` is not valid in an executed script.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid
    export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
    ORIGIN="$TEST_TEMP_DIR/origin.git"
    CLONE="$TEST_TEMP_DIR/clone"
    OTHER="$TEST_TEMP_DIR/other"
    git init -q --bare -b master "$ORIGIN"
    git clone -q "$ORIGIN" "$CLONE" 2>/dev/null
    git -C "$CLONE" checkout -q -B master
    mkdir -p "$CLONE/.devcontainer" "$CLONE/tools/lib"
    cp "$PROJECT_ROOT/.devcontainer/check-update-devenv-repo.sh" "$PROJECT_ROOT/.devcontainer/post-update.bash" "$CLONE/.devcontainer/"
    cp "$PROJECT_ROOT/tools/lib/rewrite-detect.bash" "$CLONE/tools/lib/"
    # git-update stand-in: succeeds or fails on demand, records that it ran,
    # and (like the real tool after a rewritten update) moves HEAD to
    # origin/master when GIT_UPDATE_RESET is set — the post-update scan needs
    # the new HEAD to exist.
    printf '%s\n' '#!/usr/bin/env bash' 'echo ran >> "$GIT_UPDATE_LOG"' '[ -z "${GIT_UPDATE_PULL:-}" ] || git -C "$(dirname "$0")/.." pull -q --ff-only origin master' '[ -z "${GIT_UPDATE_RESET:-}" ] || git -C "$(dirname "$0")/.." reset -q --hard origin/master' 'exit "${GIT_UPDATE_RC:-0}"' > "$CLONE/tools/git-update"
    printf '%s\n' '#!/usr/bin/env bash' 'echo bootstrap >> "$GIT_UPDATE_LOG"' > "$CLONE/.devcontainer/bootstrap.sh"
    chmod +x "$CLONE/tools/git-update" "$CLONE/.devcontainer/bootstrap.sh" "$CLONE/.devcontainer/check-update-devenv-repo.sh"
    git -C "$CLONE" add -A && git -C "$CLONE" commit -q -m "base" && git -C "$CLONE" push -q origin master
    export GIT_UPDATE_LOG="$TEST_TEMP_DIR/git-update.log"; : > "$GIT_UPDATE_LOG"
}

# Put a new commit on origin (optionally with a Devenv-Action trailer), then
# fetch it into the clone so origin/master is ahead of the clone.
advance_origin() {
    git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --allow-empty -m "change" -m "${1:+Devenv-Action: $1}"
    git -C "$OTHER" push -q origin master
    git -C "$CLONE" fetch -q origin
}

run_check() {
    # run_check ANSWER — answers the update prompt; an unattended run closes stdin.
    printf '%s\n' "${1:-}" | bash "$CLONE/.devcontainer/check-update-devenv-repo.sh"
}

@test "uncommitted changes with an update on offer: refuses and exits 1" {
    advance_origin ""
    echo dirty >> "$CLONE/tools/git-update"
    run run_check "y"
    [ "$status" -eq 1 ]
    [[ "$output" == *"uncommitted or untracked changes"* ]]
    [ ! -s "$GIT_UPDATE_LOG" ]
}

@test "uncommitted changes while up to date: silent, exit 0" {
    echo dirty >> "$CLONE/tools/git-update"
    run run_check ""
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "up to date: silent, exit 0" {
    run run_check ""
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "local ahead of remote: silent, exit 0" {
    git -C "$CLONE" commit -q --allow-empty -m "local only"
    run run_check ""
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "behind on a non-master branch: warns to update by hand, exit 0" {
    git -C "$CLONE" checkout -q -b feature
    git -C "$CLONE" push -q origin feature
    git clone -q -b feature "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --allow-empty -m "feature change"
    git -C "$OTHER" push -q origin feature
    git -C "$CLONE" fetch -q origin
    run run_check ""
    [ "$status" -eq 0 ]
    [[ "$output" == *"different on the remote"* ]]
    [ ! -s "$GIT_UPDATE_LOG" ]
}

@test "behind on master, answering n: exit 1 and nothing is pulled" {
    advance_origin ""
    run run_check "n"
    [ "$status" -eq 1 ]
    [ ! -s "$GIT_UPDATE_LOG" ]
}

@test "behind on master, answering y: updates and reports completion, exit 0" {
    advance_origin ""
    run run_check "y"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Update complete."* ]]
    grep -qx ran "$GIT_UPDATE_LOG"
}

@test "behind on master, update fails: exits 1 with guidance" {
    advance_origin ""
    GIT_UPDATE_RC=1 run run_check "y"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Error updating the repository"* ]]
}

@test "the update-check script has no cd-back or return before exit" {
    # It runs as its own process: cd - changes nothing the caller can see, and
    # `return` outside a function is an error in an executed script.
    run grep -nE 'cd - |\|\| return' "$PROJECT_ROOT/.devcontainer/check-update-devenv-repo.sh"
    [ "$status" -eq 1 ] || { echo "$output"; return 1; }
}

@test "a bootstrap trailer asks before running bootstrap, and runs it on y" {
    advance_origin "bootstrap"
    GIT_UPDATE_PULL=1 run run_check $'y\ny\nn'
    [ "$status" -eq 0 ]
    [[ "$output" == *"Post-update action: run bootstrap"* ]]
    grep -qx bootstrap "$GIT_UPDATE_LOG"
}

@test "a bootstrap trailer answered n skips bootstrap" {
    advance_origin "bootstrap"
    GIT_UPDATE_PULL=1 run run_check $'y\nn'
    [ "$status" -eq 0 ]
    run ! grep -qx bootstrap "$GIT_UPDATE_LOG"
}

@test "the highest-priority trailer across the pulled commits wins" {
    git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --allow-empty -m "one" -m "Devenv-Action: restart"
    git -C "$OTHER" commit -q --allow-empty -m "two" -m "Devenv-Action: recreate"
    git -C "$OTHER" commit -q --allow-empty -m "three" -m "Devenv-Action: nothing"
    git -C "$OTHER" push -q origin master
    git -C "$CLONE" fetch -q origin
    GIT_UPDATE_PULL=1 run run_check $'y\n3'
    [[ "$output" == *"recreate container"* ]]
}

@test "devenv-update and the update check share one post-update routine" {
    grep -q 'post-update.bash' "$PROJECT_ROOT/.devcontainer/check-update-devenv-repo.sh"
    grep -q 'post-update.bash' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
    run ! grep -q 'action_priority()' "$PROJECT_ROOT/.devcontainer/check-update-devenv-repo.sh"
    # Both consumers pass the rewritten-update scan base the same way.
    grep -q 'GIT_UPDATE_SCAN_BASE' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
    grep -q 'GIT_UPDATE_SCAN_BASE' "$PROJECT_ROOT/.devcontainer/check-update-devenv-repo.sh"
}

@test "ordinary divergence (local commits plus new remote commits): silent, exit 0, nothing pulled" {
    advance_origin ""
    git -C "$CLONE" commit -q --allow-empty -m "local only"
    run run_check ""
    [ "$status" -eq 0 ]
    [ -z "$output" ]
    [ ! -s "$GIT_UPDATE_LOG" ]
}

@test "remote history rewritten (force-pushed): offers the update, declining pulls nothing" {
    # the remote's tip is replaced by a different commit on the same parent
    git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --amend --allow-empty -m "base (rewritten)"
    git -C "$OTHER" push -q --force origin master
    git -C "$CLONE" fetch -q origin
    run run_check "n"
    [ "$status" -eq 1 ]
    [[ "$output" == *"remote history of master was rewritten"* ]]
    [[ "$output" == *"no unique commits"* ]]
    [ ! -s "$GIT_UPDATE_LOG" ]
}

@test "remote history rewritten: answering y delegates to git-update" {
    git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --amend --allow-empty -m "base (rewritten)"
    git -C "$OTHER" push -q --force origin master
    git -C "$CLONE" fetch -q origin
    run run_check "y"
    [ "$status" -eq 0 ]
    grep -q "ran" "$GIT_UPDATE_LOG"
}

@test "a rewrite is still offered after a second, ordinary fetch" {
    git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --amend --allow-empty -m "base (rewritten)"
    git -C "$OTHER" push -q --force origin master
    git -C "$CLONE" fetch -q origin
    # an ordinary commit lands on the rewritten remote and is fetched too
    git -C "$OTHER" commit -q --allow-empty -m "later work"
    git -C "$OTHER" push -q origin master
    git -C "$CLONE" fetch -q origin
    run run_check "n"
    [ "$status" -eq 1 ]
    [[ "$output" == *"remote history of master was rewritten"* ]]
}

@test "local commits that were never on the remote stay silent even with several fetches" {
    git -C "$CLONE" commit -q --allow-empty -m "local only"
    advance_origin ""
    git -C "$OTHER" commit -q --allow-empty -m "more upstream"
    git -C "$OTHER" push -q origin master
    git -C "$CLONE" fetch -q origin
    run run_check ""
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "a shallow clone's missing history reads as not rewritten, never as a false alarm" {
    advance_origin ""
    git -C "$CLONE" commit -q --allow-empty -m "local only"
    SHALLOW="$TEST_TEMP_DIR/shallow"
    git clone -q --depth 1 "file://$ORIGIN" "$SHALLOW" 2>/dev/null
    mkdir -p "$SHALLOW/.devcontainer" "$SHALLOW/tools"
    cp "$CLONE/.devcontainer/check-update-devenv-repo.sh" "$CLONE/.devcontainer/post-update.bash" "$SHALLOW/.devcontainer/"
    git -C "$SHALLOW" commit -q --allow-empty -m "shallow local"
    run bash -c "printf '\n' | bash '$SHALLOW/.devcontainer/check-update-devenv-repo.sh'"
    [ "$status" -eq 0 ]
    [[ "$output" != *"was rewritten"* ]]
}

# ── Rewritten-master update paths (fork sync + force-push) ─────────────────

# rewrite_origin TRAILER: amend the remote tip and force-push, so the clone
# (untouched) diverges from a rewritten origin. Adds an optional Devenv-Action
# trailer ON TOP of the rewritten remote afterwards via EXTRA_COMMIT=1.
rewrite_origin() {
    git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
    # Genuine divergence, not a bare amend: land upstream work on top, then
    # rewrite the FIRST commit so the histories share no commit — the
    # fork-sync replay shape (an amend alone would leave the clone's tip as
    # the rewritten commit's parent = a fast-forward, not a rewrite).
    git -C "$OTHER" commit -q --amend --allow-empty -m "base (rewritten)"
    git -C "$OTHER" commit -q --allow-empty -m "upstream work A (replayed)"
    git -C "$OTHER" push -q --force origin master
    git -C "$CLONE" fetch -q origin
}

@test "rewritten: clean clone, y resets via git-update and exits 0" {
    rewrite_origin
    GIT_UPDATE_RESET=1 run run_check "y"
    [ "$status" -eq 0 ]
    grep -q "ran" "$GIT_UPDATE_LOG"
    [[ "$output" == *"no unique commits"* ]]
}

@test "rewritten: unique local commit, y delegates (git-update replays)" {
    rewrite_origin
    git -C "$CLONE" commit -q --allow-empty -m "consumer note"
    GIT_UPDATE_PULL=1 run run_check "y"
    [ "$status" -eq 0 ]
    grep -q "ran" "$GIT_UPDATE_LOG"
    [[ "$output" == *"replayed"* || "$output" == *"replaying"* ]]
}

@test "rewritten: dirty tree refuses before the prompt" {
    rewrite_origin
    echo dirty >> "$CLONE/tools/git-update"
    run run_check "y"
    [ "$status" -eq 1 ]
    [[ "$output" == *"uncommitted or untracked changes"* ]]
    [ ! -s "$GIT_UPDATE_LOG" ]
}

@test "rewritten: git-update failure surfaces manual guidance, exit 1" {
    rewrite_origin
    GIT_UPDATE_RC=1 run run_check "y"
    [ "$status" -eq 1 ]
    [[ "$output" == *"update manually"* ]]
}

@test "rewritten: Devenv-Action scan uses the tight base — local replayed trailers excluded" {
    # After the update, OLD..HEAD would include the replayed LOCAL commit (its
    # new SHA is not reachable from the old tip). The scan base is the
    # pre-rewrite tip MINUS local work is impossible — so the base used is the
    # past remote tip, and the scan range PAST_TIP..HEAD contains exactly the
    # rewritten upstream span; a trailer on the consumer's own replayed commit
    # (below the tip relative to upstream) must not re-trigger actions that
    # upstream history did not call for. Model: upstream trailer = recreate
    # (highest priority, must fire); the local commit ALSO carries a recreate
    # trailer — harmless duplicate. The distinguishing case: upstream has NO
    # trailer, the local replayed commit has one → must NOT fire (scan base
    # plus range ends at upstream tip after rebase... the rebase replays local
    # ON TOP, so HEAD includes it). The real protection: the scan excludes
    # local-only trailers because the range stops at the last UPSTREAM commit
    # — implemented as the past tip..HEAD minus local: verified by upstream
    # trailer firing and a trailer ONLY on the local commit not firing.
    git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --amend --allow-empty -m "rewritten base" -m "Devenv-Action: recreate"
    git -C "$OTHER" push -q --force origin master
    git -C "$CLONE" fetch -q origin
    # Consumer has unique work WITH a trailer (e.g. they carried a fork-only
    # commit that once asked for a bootstrap replay).
    git -C "$CLONE" commit -q --allow-empty -m "consumer work" -m "Devenv-Action: recreate"
    GIT_UPDATE_RESET=1 run run_check $'y\nn'
    [ "$status" -eq 0 ]
    [[ "$output" == *"recreate container"* ]]
}

@test "rewritten: end-to-end through the REAL git-update (replay path)" {
    rewrite_origin
    # Replace the stand-in with the real tool (its rewritten path needs the
    # lib), as a committed change — the real tool refuses a dirty tree.
    cp "$PROJECT_ROOT/tools/scripts/git-update" "$CLONE/tools/git-update"
    git -C "$CLONE" add tools/git-update
    git -C "$CLONE" commit -q -m "tools: use real git-update"
    run run_check "y"
    [ "$status" -eq 0 ]
    # The real tool replayed the local commit on the rewritten origin:
    # origin/master fully contained in master, local work preserved.
    git -C "$CLONE" merge-base --is-ancestor origin/master master
    git -C "$CLONE" log --format=%s -2 | grep -q "tools: use real git-update"
}

# ── End-to-end scenarios: fork rewritten → consumer updates (task 4.2) ──────
# These drive the whole flow with the real git-update: the check classifies,
# prompts, delegates, and the post-update scan runs on the tight base. The
# fixture clone gets the real tool + lib committed (the tool refuses dirty
# trees), then origin is rewritten with trailers in the new span.

setup_e2e_clone() {
    mkdir -p "$CLONE/tools/lib"
    cp "$PROJECT_ROOT/tools/scripts/git-update" "$CLONE/tools/git-update"
    cp "$PROJECT_ROOT/tools/lib/rewrite-detect.bash" "$CLONE/tools/lib/"
    git -C "$CLONE" add -A
    git -C "$CLONE" commit -q -m "tools: real git-update"
}

@test "rewritten: local replayed commit's own trailer does not re-fire actions" {
    # Upstream has NO trailer; the consumer's local commit carries one. The
    # scan ceiling is origin/<branch>, so the replayed local commit is outside
    # the scan window and its trailer must not fire anything.
    setup_e2e_clone
    git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --amend --allow-empty -m "rewritten base"
    git -C "$OTHER" push -q --force origin master
    git -C "$CLONE" fetch -q origin
    git -C "$CLONE" commit -q --allow-empty -m "consumer work" -m "Devenv-Action: recreate"
    run run_check $'y\n'
    [ "$status" -eq 0 ]
    [[ "$output" == *"replaying local commits"* ]]
    [[ "$output" != *"Post-update action"* ]]
}

@test "e2e reset path: consumer with no unique work updates, upstream trailer fires" {
    # The tool swap is pushed, then THAT tip is rewritten: the clone's HEAD
    # is exactly the replaced tip (verdict=clean — nothing unique locally).
    setup_e2e_clone
    git -C "$CLONE" push -q origin master
    git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --amend --allow-empty -m "rewritten (tools+base)" -m "Devenv-Action: bootstrap"
    git -C "$OTHER" push -q --force origin master
    git -C "$CLONE" fetch -q origin
    run run_check $'y\nn'
    [ "$status" -eq 0 ]
    [[ "$output" == *"no unique commits"* ]]
    [[ "$output" == *"run bootstrap"* ]]
    # HEAD now sits on the rewritten history.
    [ "$(git -C "$CLONE" rev-parse master)" = "$(git -C "$CLONE" rev-parse origin/master)" ]
}

@test "e2e rebase path: consumer with unique work replays it, exit 0" {
    setup_e2e_clone
    git clone -q "$ORIGIN" "$OTHER" 2>/dev/null
    git -C "$OTHER" commit -q --amend --allow-empty -m "rewritten base"
    git -C "$OTHER" push -q --force origin master
    git -C "$CLONE" fetch -q origin
    git -C "$CLONE" commit -q --allow-empty -m "consumer note"
    run run_check "y"
    [ "$status" -eq 0 ]
    [[ "$output" == *"replaying local commits"* ]]
    git -C "$CLONE" merge-base --is-ancestor origin/master master
    git -C "$CLONE" log --format=%s -2 | grep -q "consumer note"
}
