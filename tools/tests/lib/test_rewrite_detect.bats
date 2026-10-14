#!/usr/bin/env bats
# tools/lib/rewrite-detect.bash: the shared rewrite classifier. All verdicts,
# the base-tip output, and the safety split (clean = HEAD is the past remote
# tip; diverged = HEAD has unique work).

bats_require_minimum_version 1.5.0

load ../test_helper

LIB="$BATS_TEST_DIRNAME/../../lib/rewrite-detect.bash"

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

# rewrite_origin: amend the tip on a second clone and force-push, so the first
# clone's origin/master is rewritten away from its HEAD. Sets OLD_TIP.
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

detect_in_clone() {
    (cd "$CLONE" && source "$LIB" && rewrite_detect_state master)
}

@test "lib: not diverged (up to date) classifies none" {
    [ "$(detect_in_clone)" = "none" ]
}

@test "lib: strictly behind classifies none (the caller's ordinary pull)" {
    local other="$TEST_TEMP_DIR/ahead"
    git clone -q "$ORIGIN" "$other"
    git -C "$other" commit -q --allow-empty -m "new upstream work"
    git -C "$other" push -q origin master
    git -C "$CLONE" fetch -q origin
    [ "$(detect_in_clone)" = "none" ]
}

@test "lib: strictly ahead classifies none (local-only work)" {
    git -C "$CLONE" commit -q --allow-empty -m "local only"
    [ "$(detect_in_clone)" = "none" ]
}

@test "lib: rewritten remote + untouched clone classifies clean with the past tip" {
    rewrite_origin
    local out verdict past
    out="$(detect_in_clone)"
    verdict="${out%% *}"
    past="${out#* }"
    [ "$verdict" = "clean" ]
    [ "$past" = "$OLD_TIP" ]
}

@test "lib: rewritten remote + unique local work classifies diverged with the base tip" {
    rewrite_origin
    git -C "$CLONE" commit -q --allow-empty -m "consumer note"
    local out verdict past
    out="$(detect_in_clone)"
    verdict="${out%% *}"
    past="${out#* }"
    [ "$verdict" = "diverged" ]
    [ "$past" = "$OLD_TIP" ]
}

@test "lib: ordinary divergence (no rewrite on record) classifies none" {
    # Diverged without any rewrite: the remote moved forward past local work,
    # merged by a third party — a plain merge/rebase situation, not a reset.
    local third="$TEST_TEMP_DIR/third"
    git clone -q "$ORIGIN" "$third"
    git -C "$CLONE" commit -q --allow-empty -m "local line"
    git -C "$third" commit -q --allow-empty -m "remote line"
    git -C "$third" push -q origin master
    git -C "$CLONE" fetch -q origin
    [ "$(detect_in_clone)" = "none" ]
}

@test "lib: sourcing twice is a no-op (guard)" {
    local out
    out="$(cd "$CLONE" && source "$LIB" && source "$LIB" && rewrite_detect_state master)"
    [ -n "$out" ]
}
