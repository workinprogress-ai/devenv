#!/usr/bin/env bats
# repo-bisect tests (Plan-004 Phase 6): first-bad identification on any
# branch, dirty-tree refusal, unsandboxed notice, scratchpad composition.

bats_require_minimum_version 1.5.0
load ../test_helper

setup() {
    test_helper_setup
    BS_REPO="$TEST_TEMP_DIR/bs-repo"
    create_mock_git_repo "$BS_REPO"
    cd "$BS_REPO"
    # History: init -> good base -> break(bad). The search range must have an
    # interior commit; a 2-commit range (good==bad-1) aborts as degenerate.
    echo good > probe.txt
    git add probe.txt
    git commit -qm "good base"
    git tag good-ref
    echo neutral > probe.txt
    git add probe.txt
    git commit -qm "neutral middle"
    echo "broken" > probe.txt
    git add probe.txt
    git commit -qm "introduce defect"
    git tag bad-ref
    export BS_SCRIPT="$DEVENV_TOOLS/scripts/repo-bisect.sh"
}

bs() {
    bash "$BS_SCRIPT" "$@"
}

@test "bisect: identifies the first bad commit on any branch (no scratchpad needed)" {
    # Probe convention: exit 0 = good (defect ABSENT). grep exits 0 when found,
    # so the probe negates: '! grep -q broken' → 0 on good commits, 1 on the
    # broken one.
    run bs bad-ref good-ref -- sh -c "! grep -q 'broken' probe.txt"
    [ "$status" -eq 0 ]
    [[ "$output" == *"FIRST-BAD:"* ]]
    [[ "$output" == *"introduce defect"* ]]
}

@test "bisect: prints the unsandboxed notice outside a scratchpad" {
    run bs bad-ref good-ref -- sh -c "! grep -q 'broken' probe.txt"
    [ "$status" -eq 0 ]
    [[ "$output" == *"notice: operating on"* ]]
    [[ "$output" == *"repo-scratchpad enter"* ]]
}

@test "bisect: no notice inside an active scratchpad" {
    bash "$DEVENV_TOOLS/scripts/repo-scratchpad.sh" enter >/dev/null
    run bs bad-ref good-ref -- sh -c "! grep -q 'broken' probe.txt"
    [ "$status" -eq 0 ]
    [[ "$output" != *"notice: operating on"* ]]
    [[ "$output" == *"FIRST-BAD:"* ]]
    # Bisect session cleaned up after the run.
    run git show-ref --verify --quiet refs/bisect/start
    [ "$status" -ne 0 ]
}

@test "bisect: refuses on a dirty tree" {
    echo dirt >> probe.txt
    run bs bad-ref good-ref -- grep -q "broken" probe.txt
    [ "$status" -eq 1 ]
    [[ "$output" == *"working tree is dirty"* ]]
}

@test "bisect: reports when the probe never discriminates (all-skip probe)" {
    # Exit 125 = skip. A probe that skips every step leaves the walk with no
    # terms — git reports "could be any of"; the tool answers AMBIGUOUS, never
    # fabricating a culprit from an ambiguous candidate set.
    run bs bad-ref good-ref -- sh -c "exit 125"
    [ "$status" -eq 1 ]
    [[ "$output" == *"AMBIGUOUS"* ]]
    [[ "$output" != *"FIRST-BAD:"* ]]
}

@test "bisect: unresolvable refs refused (exit 4)" {
    run bs not-a-ref good-ref -- true
    [ "$status" -eq 4 ]
    run bs bad-ref also-not-a-ref -- true
    [ "$status" -eq 4 ]
}

@test "bisect: probe commits via scratchpad commit compose (the P2 extension point)" {
    bash "$DEVENV_TOOLS/scripts/repo-scratchpad.sh" enter >/dev/null
    # Make a scratch commit that breaks the probe, then hunt from it. The good
    # anchor is the mock init commit — strictly below the scratch base, so the
    # range is non-degenerate even though the scratch tip is one commit tall.
    echo "worse" > probe.txt
    git add -A
    bash "$DEVENV_TOOLS/scripts/repo-scratchpad.sh" commit "make it worse" >/dev/null
    run bs HEAD "$(git rev-list --max-parents=0 HEAD)" -- sh -c "! grep -q 'worse' probe.txt"
    [ "$status" -eq 0 ]
    [[ "$output" == *"FIRST-BAD:"* ]]
    # Still on the scratch branch after the hunt (branch tip never moved).
    [ "$(git symbolic-ref --short HEAD)" = "scratchpad/exp" ]
}
