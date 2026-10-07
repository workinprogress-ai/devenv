#!/usr/bin/env bats
# pr-create-for-review: a REVIEW: PR between two commits, built on two temporary
# branches. Those branches are the PR's base and head, so a successful run must leave
# them on the remote (pr-cleanup-review-branches retires them later); only a failed
# run, whose PR was never created, takes its pushed branches back out. The local
# branches are scaffolding either way.

bats_require_minimum_version 1.5.0

load ../test_helper

SCRIPT="$BATS_TEST_DIRNAME/../../scripts/pr-create-for-review.sh"

setup() {
    test_helper_setup
    export HOME="$TEST_TEMP_DIR/home"; mkdir -p "$HOME"
    export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test
    ORIGIN="$TEST_TEMP_DIR/origin.git"
    CLONE="$TEST_TEMP_DIR/work/proj"
    git init -q --bare "$ORIGIN"
    git init -q "$CLONE"
    git -C "$CLONE" config user.email t@example.test
    git -C "$CLONE" config user.name t
    git -C "$CLONE" remote add origin "$ORIGIN"
    for n in 1 2 3; do
        echo "c$n" > "$CLONE/f.txt"; git -C "$CLONE" add f.txt; git -C "$CLONE" commit -q -m "c$n"
    done
    git -C "$CLONE" tag v1.0.0 "$(git -C "$CLONE" rev-parse HEAD~2)"
    git -C "$CLONE" tag v1.1.0 HEAD
    git -C "$CLONE" push -q origin HEAD:master --tags
    FROM="$(git -C "$CLONE" rev-parse HEAD~1)"
    TO="$(git -C "$CLONE" rev-parse HEAD)"
    # gh stub: a PR create prints a PR URL; FAKE_GH_FAIL=1 makes it print nothing
    mkdir -p "$TEST_TEMP_DIR/bin"
    cat > "$TEST_TEMP_DIR/bin/gh" <<'STUB'
#!/usr/bin/env bash
if [ -n "${FAKE_GH_FAIL:-}" ]; then echo "boom" >&2; exit 1; fi
case "$*" in *"pr create"*) echo "https://github.com/o/r/pull/9" ;; esac
exit 0
STUB
    chmod +x "$TEST_TEMP_DIR/bin/gh"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
}

teardown() {
    test_helper_teardown
}

remote_review_branches() { git -C "$ORIGIN" for-each-ref --format='%(refname:short)' 'refs/heads/review/'; }
local_review_branches()  { git -C "$CLONE"  for-each-ref --format='%(refname:short)' 'refs/heads/review/'; }

@test "a successful run leaves both review branches on the remote, because the PR needs them" {
    run bash "$SCRIPT" "check the changes" "$CLONE" "$FROM" "$TO"
    [ "$status" -eq 0 ]
    [[ "$output" == *"https://github.com/o/r/pull/9"* ]]
    [ "$(remote_review_branches | wc -l)" -eq 2 ]
    remote_review_branches | grep -q -- '-source$'
    remote_review_branches | grep -q -- '-target$'
}

@test "a successful run removes the temporary local branches and returns to the original branch" {
    run bash "$SCRIPT" "check the changes" "$CLONE" "$FROM" "$TO"
    [ "$status" -eq 0 ]
    [ -z "$(local_review_branches)" ]
    [ "$(git -C "$CLONE" rev-parse --abbrev-ref HEAD)" = "master" ]
}

@test "a run whose PR could not be created takes its pushed branches back off the remote" {
    FAKE_GH_FAIL=1 run bash "$SCRIPT" "check the changes" "$CLONE" "$FROM" "$TO"
    [ "$status" -ne 0 ]
    [ -z "$(remote_review_branches)" ]
    [ -z "$(local_review_branches)" ]
}

@test "the branch name does not depend on uuidgen being installed" {
    # a PATH without uuidgen: the run must still produce a review branch
    run env PATH="$TEST_TEMP_DIR/bin:$(dirname "$(command -v git)"):/usr/bin:/bin" bash -c '
        command -v uuidgen >/dev/null && { echo "uuidgen present in this PATH"; exit 0; }
        bash "$0" "check" "$1" "$2" "$3"
    ' "$SCRIPT" "$CLONE" "$FROM" "$TO"
    [ "$status" -eq 0 ]
    [ "$(remote_review_branches | wc -l)" -eq 2 ]
}
