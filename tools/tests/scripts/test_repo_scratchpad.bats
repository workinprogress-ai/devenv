#!/usr/bin/env bats
# State-machine tests for repo-scratchpad (Plan-004 Phase 2).
# Covers: enter fail-closed rule + --carry, commit branding + hook bypass,
# reset safety, promote staged-uncommitted, exit cleanup, refs-based
# detection incl. detached-HEAD safety, one-active-per-repo, bisect guards.

bats_require_minimum_version 1.5.0
load ../test_helper

setup() {
    test_helper_setup
    SP_REPO="$TEST_TEMP_DIR/sp-repo"
    create_mock_git_repo "$SP_REPO"
    cd "$SP_REPO"
    # Baseline commit is the base every scratchpad is cut from.
    git commit -q --allow-empty -m "base"
    export SP_BASE="$(git rev-parse HEAD)"
    export SP_BASE_BRANCH="$(git symbolic-ref --short HEAD)"
    export SP_SCRIPT="$DEVENV_TOOLS/repo-scratchpad"
}

sp() {
    bash "$SP_SCRIPT" "$@"
}

@test "enter: refuses on dirty tree with guidance naming git wip (fail-closed, tracked changes)" {
    echo dirt >> README.md
    run sp enter
    [ "$status" -eq 1 ]
    [[ "$output" == *"working tree is dirty"* ]]
    [[ "$output" == *"git wip"* ]]
    # Branch must NOT have been created.
    run git show-ref --verify --quiet refs/heads/scratchpad/exp
    [ "$status" -ne 0 ]
}

@test "enter: refuses on untracked files (untracked = dirty, one uniform rule)" {
    echo new > untracked.txt
    run sp enter
    [ "$status" -eq 1 ]
    [[ "$output" == *"working tree is dirty"* ]]
    run git show-ref --verify --quiet refs/heads/scratchpad/exp
    [ "$status" -ne 0 ]
}

@test "enter: --carry proceeds on dirty tree with warning + snapshot patch" {
    echo dirt >> README.md
    run sp enter --carry
    [ "$status" -eq 0 ]
    [[ "$output" == *"CARRY"* ]]
    [[ "$output" == *"DESTROY"* ]]
    [ -f ".local-artifacts/tmp/scratchpad/exp-carry.patch" ]
    grep -q "dirt" ".local-artifacts/tmp/scratchpad/exp-carry.patch"
    # Branch exists and state recorded.
    git show-ref --verify --quiet refs/heads/scratchpad/exp
}

@test "enter: succeeds on clean tree, cuts branch, records refs" {
    run sp enter testslug
    [ "$status" -eq 0 ]
    [[ "$output" == *"Scratchpad active: scratchpad/testslug"* ]]
    git show-ref --verify --quiet refs/heads/scratchpad/testslug
    git show-ref --verify --quiet refs/scratchpad/base
    git show-ref --verify --quiet refs/scratchpad/state
    # On the scratch branch now.
    [ "$(git symbolic-ref --short HEAD)" = "scratchpad/testslug" ]
}

@test "enter: refuses slug that is not branch-name-safe" {
    run sp enter "Bad_Slug!"
    [ "$status" -eq 2 ]
}

@test "enter: refuses when a scratchpad is already active (one per repo)" {
    sp enter >/dev/null
    run sp enter other
    [ "$status" -eq 3 ]
    [[ "$output" == *"already active"* ]]
}

@test "commit: brands with scratch: prefix and records state ref" {
    sp enter >/dev/null
    echo work > w.txt
    run sp commit "probe one"
    [ "$status" -eq 0 ]
    [[ "$(git log -1 --format=%s)" == "scratch: probe one" ]]
}

@test "commit: bypasses enforcement hooks (commit -n)" {
    # Install a blocking pre-commit + commit-msg like the enforcement layer.
    mkdir -p .git/hooks
    printf '#!/bin/bash\nexit 1\n' > .git/hooks/pre-commit
    chmod +x .git/hooks/pre-commit
    sp enter >/dev/null
    echo work > w.txt
    run sp commit "must bypass"
    [ "$status" -eq 0 ]
    [ "$(git log -1 --format=%s)" = "scratch: must bypass" ]
}

@test "commit: refuses outside a scratchpad" {
    echo work > w.txt
    run sp commit "nope"
    [ "$status" -eq 1 ]
    [[ "$output" == *"no scratchpad active"* ]]
}

@test "reset: returns branch to base, AI-safe, removes scratch content" {
    sp enter >/dev/null
    echo work > w.txt && git add -A && sp commit "to be destroyed" >/dev/null
    local base_count
    base_count="$(git rev-list --count "$SP_BASE")"
    [ "$(git rev-list --count HEAD)" -eq $((base_count + 1)) ]
    run sp reset
    [ "$status" -eq 0 ]
    [ "$(git rev-list --count HEAD)" -eq "$base_count" ]
    [ ! -e w.txt ]
}

@test "reset: carried dirty work is destroyed on the --carry path (documented hazard)" {
    echo carried >> README.md
    sp enter --carry >/dev/null
    run sp reset
    [ "$status" -eq 0 ]
    # Carried modification is gone from the tree (the documented hazard;
    # the snapshot patch remains as the salvage record).
    run grep -q "carried" README.md
    [ "$status" -ne 0 ]
    # Snapshot lives at the ROOT-scoped carry dir (C2 fix) — survives reset.
    [ -f "$TEST_TEMP_DIR/sp-repo/.local-artifacts/tmp/scratchpad/exp-carry.patch" ]
}

@test "reset: refuses while a bisect session is mid-flight" {
    sp enter >/dev/null
    mkdir -p .git/refs/bisect
    git update-ref refs/bisect/start "$(git rev-parse HEAD)"
    run sp reset
    [ "$status" -eq 1 ]
    [[ "$output" == *"bisect"* ]]
}

@test "promote: lands the scratch commit staged-uncommitted on base with no commit created" {
    sp enter >/dev/null
    echo fix > fix.txt && git add -A && sp commit "the fix" >/dev/null
    local fix_sha
    fix_sha="$(git rev-parse HEAD)"
    run sp promote "$fix_sha"
    [ "$status" -eq 0 ]
    # Back on base, no new commit, but the change is staged.
    [ "$(git rev-parse HEAD)" = "$(git rev-parse refs/scratchpad/base)" ]
    [ -f fix.txt ]
    git diff --cached --quiet && return 1 || return 0   # something IS staged
}

@test "promote: refuses a sha not on the scratchpad branch" {
    sp enter >/dev/null
    run sp promote "$(git rev-parse refs/scratchpad/base)"
    [ "$status" -eq 4 ]
}

@test "exit: returns to base, deletes branch, clears refs, prints tip" {
    sp enter >/dev/null
    echo work > w.txt && git add -A && sp commit "scratch work" >/dev/null
    local tip
    tip="$(git rev-parse HEAD)"
    run sp exit
    [ "$status" -eq 0 ]
    [[ "$output" == *"$tip"* ]]
    [ "$(git symbolic-ref --short HEAD)" = "$SP_BASE_BRANCH" ]
    # Scratch branch and state refs must be gone.
    run git show-ref --verify --quiet refs/heads/scratchpad/exp
    [ "$status" -ne 0 ]
    run git show-ref --verify --quiet refs/scratchpad/base
    [ "$status" -ne 0 ]
    run git show-ref --verify --quiet refs/scratchpad/state
    [ "$status" -ne 0 ]
    run git show-ref --verify --quiet refs/scratchpad/origin-branch
    [ "$status" -ne 0 ]
}

@test "exit: refuses while a bisect session is mid-flight" {
    sp enter >/dev/null
    git update-ref refs/bisect/start "$(git rev-parse HEAD)"
    run sp exit
    [ "$status" -eq 1 ]
    [[ "$output" == *"bisect"* ]]
}

@test "detection: is detached-HEAD-safe (state ref, not branch name)" {
    # Simulate a bisect's detached checkout: detach HEAD, then verify the
    # mode is still detected via the metadata ref.
    sp enter >/dev/null
    git checkout -q --detach HEAD
    # The script's status must still report active while detached.
    run sp status
    [ "$status" -eq 0 ]
    [[ "$output" == *"Scratchpad active"* ]]
}

@test "status: reports inactive on a fresh repo" {
    run sp status
    [ "$status" -eq 0 ]
    [[ "$output" == *"No scratchpad active"* ]]
}

@test "lib: dirty-entry refusal text is stable (P3 contract consumer)" {
    echo dirt > x.txt
    local out
    out="$(bash "$DEVENV_TOOLS/repo-scratchpad" enter 2>&1)" || true
    [[ "$out" == *"Error: working tree is dirty"* ]]
    [[ "$out" == *"git wip"* ]]
}

# --- Phase 3: Restrictions & refusals (Plan-004) ---

@test "refusal contract: git-wip blocked while scratchpad active (exit 3, sentinel)" {
    sp enter >/dev/null
    run "$DEVENV_TOOLS/git-wip" "wip msg"
    [ "$status" -eq 3 ]
    [[ "$output" == *"git-wip is blocked while a scratchpad is active"* ]]
    [[ "$output" == *"repo-scratchpad promote"* ]]
}

@test "refusal contract: repo-commit blocked while scratchpad active (exit 3, sentinel)" {
    sp enter >/dev/null
    echo x >> README.md && git add README.md
    run "$DEVENV_TOOLS/repo-commit" "some message"
    [ "$status" -eq 3 ]
    [[ "$output" == *"repo-commit is blocked while a scratchpad is active"* ]]
}

@test "refusal contract: pr-create blocked while scratchpad active (exit 3, push sentinel)" {
    sp enter >/dev/null
    run "$DEVENV_TOOLS/pr-create" "title" --no-issue
    [ "$status" -eq 3 ]
    [[ "$output" == *"pr-create push is blocked on a scratchpad branch"* ]]
}

@test "refusal contract: restricted tools work normally when no scratchpad (no false positives)" {
    # repo-commit proceeds past the refusal gate (reaches its own option refusal).
    run "$DEVENV_TOOLS/repo-commit" -m "opt"
    [ "$status" -eq 1 ]
    [[ "$output" == *"options are refused by design"* ]]
    # pr-create gets past the scratchpad gate (reaches its own arg validation).
    run "$DEVENV_TOOLS/pr-create"
    [ "$status" -ne 3 ]
}

@test "push-path defense-in-depth: bare scratchpad/* branch (no state refs) blocks push tools" {
    # Simulate orphaned state: branch under the prefix, no scratchpad refs.
    git checkout -q -b scratchpad/orphan
    run "$DEVENV_TOOLS/git-wip" "wip msg"
    [ "$status" -eq 3 ]
    [[ "$output" == *"push is blocked on a scratchpad branch"* ]]
    run "$DEVENV_TOOLS/pr-create" "t" --no-issue
    [ "$status" -eq 3 ]
    # Normal branch is unaffected.
    git checkout -q "$SP_BASE_BRANCH"
    run "$DEVENV_TOOLS/git-wip" --definitely-not-a-flag
    [ "$status" -eq 1 ]
}

@test "lib: scratchpad_on_scratch_branch detects prefix without state refs" {
    git checkout -q -b scratchpad/orphan2
    # is_scratchpad_active says no (no refs)...
    run bash -c "source '$DEVENV_TOOLS/lib/scratchpad.bash' && is_scratchpad_active && echo ACTIVE || echo INACTIVE"
    [[ "$output" == *"INACTIVE"* ]]
    # ...but the branch-layer check says yes.
    run bash -c "source '$DEVENV_TOOLS/lib/scratchpad.bash' && scratchpad_on_scratch_branch && echo BRANCHLAYER || echo NOMATCH"
    [[ "$output" == *"BRANCHLAYER"* ]]
}

# --- Round 1 review fixes (Plan-004 Phase 8) ---

@test "B1: commit refuses when HEAD is off the scratch branch (post-promote pause)" {
    sp enter >/dev/null
    echo fix > fix.txt && git add -A && sp commit "the fix" >/dev/null
    local fix_sha
    fix_sha="$(git rev-parse HEAD)"
    sp promote "$fix_sha" >/dev/null
    # Head is now on the origin branch with state refs live (paused).
    run sp commit "must refuse"
    [ "$status" -eq 1 ]
    [[ "$output" == *"HEAD is not on the scratch branch"* ]]
    # And reset must refuse too (would rewind the origin branch).
    run sp reset
    [ "$status" -eq 1 ]
}

@test "B1: enter refuses while a foreign bisect is in flight" {
    git update-ref refs/bisect/start "$(git rev-parse HEAD)"
    run sp enter
    [ "$status" -eq 1 ]
    [[ "$output" == *"bisect"* ]]
    run git show-ref --verify --quiet refs/heads/scratchpad/exp
    [ "$status" -ne 0 ]
}

@test "B1: resume refuses on staged salvage; exit-then-flow lands it" {
    sp enter >/dev/null
    echo fix > fix.txt && git add -A && sp commit "salvage" >/dev/null
    sp promote "$(git rev-parse HEAD)" >/dev/null
    # The salvage is STAGED in the index: resume must refuse (commit/reset
    # would sweep or destroy it), naming the land-it-first path.
    run sp resume
    [ "$status" -eq 1 ]
    [[ "$output" == *"staged salvage"* ]]
    [[ "$output" == *"repo-scratchpad exit"* ]]
    # The sanctioned landing: exit keeps staged work on the origin branch.
    run sp exit
    [ "$status" -eq 0 ]
    [ -f fix.txt ]
    run git diff --cached --quiet
    [ "$status" -ne 0 ]
}

@test "C3: ghost state gets a friendly recovery pointer, not a raw git error" {
    # Manufacture a TRUE ghost: the state tip points at a commit no scratch
    # branch has (scratch work committed, then the branch rewound under it),
    # with a second scratch branch present so the unique-prefix self-heal
    # cannot silently rescue discovery.
    sp enter >/dev/null
    git branch scratchpad/other
    # TRUE ghost: the state ref points at a dangling commit no branch has
    # (commit-tree gives a sha with no ref). Both scratch branches sit at
    # other shas, so tip-match fails and the two-branch count defeats the
    # unique-prefix self-heal — discovery returns empty.
    ghost="$(git commit-tree "$(git rev-parse HEAD^{tree})" -m ghost)"
    git update-ref refs/scratchpad/state "$ghost"
    run sp status
    [ "$status" -eq 1 ]
    [[ "$output" == *"ghost state"* ]]
    [[ "$output" == *"update-ref -d"* ]]
    run sp exit
    [ "$status" -eq 1 ]
    [[ "$output" == *"ghost state"* ]]
}

@test "C1: promote output names the exit-then-commit unblock (no raw checkout advice)" {
    sp enter >/dev/null
    echo fix > fix.txt && git add -A && sp commit "the fix" >/dev/null
    run sp promote "$(git rev-parse HEAD)"
    [ "$status" -eq 0 ]
    [[ "$output" == *"repo-scratchpad exit"* ]]
    [[ "$output" == *"repo-scratchpad resume"* ]]
    [[ "$output" != *"git checkout"* ]]
}

@test "nit: slug with consecutive dots refused with the friendly message" {
    run sp enter "a..b"
    [ "$status" -eq 2 ]
    [[ "$output" == *"no '..'"* ]]
}
