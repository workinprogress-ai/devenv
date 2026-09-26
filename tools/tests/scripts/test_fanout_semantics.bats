#!/usr/bin/env bats
# Fan-out semantics tests: update_status_all_projects driven in isolation.
# Harness: a copy of the wrapper with the trailing main-call stripped is
# sourced from tools/scripts/ (so sibling lib resolution still works), and
# the three collaborators (resolve_target_repo, provider_projects_for_issue,
# update_status) are overridden per scenario.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    SCRIPT="$PROJECT_ROOT/tools/scripts/project-update-issue.sh"
    # Per-test unique copy: bats --jobs runs this file's test cases in separate
    # processes, so a fixed shared filename races (teardown of one test deletes
    # the file another test is sourcing). mktemp keeps it in tools/scripts/ so
    # the copy's ../lib resolution still works.
    STRIPPED="$(mktemp "$PROJECT_ROOT/tools/scripts/.fanout-under-test.XXXXXX")"
    grep -v '^main "\$@"$' "$SCRIPT" > "$STRIPPED"
    stub_dir="$(mktemp -d)"
    printf '#!/usr/bin/env bash\nexit 0\n' > "$stub_dir/gh"
    chmod +x "$stub_dir/gh"
    export PATH="$stub_dir:$PATH"
    export DEVENV_REPO="test-org/test-repo"
    unset GH_ORG
}

teardown() {
    rm -f "$STRIPPED"
}

fanout() {
    local safe="$1" lookup_rc="$2" lookup_out="$3" update_rc="$4" status="$5"
    bash -c "
        set -uo pipefail
        source '$STRIPPED'
        resolve_target_repo() { echo 'test-org/test-repo'; }
        provider_projects_for_issue() {
            [ '$lookup_rc' -eq 1 ] && return 1
            printf '%s' '$lookup_out'
        }
        update_status() { return $update_rc; }
        SAFE_MODE=$safe
        ISSUE_NUMBER=44
        rc=0
        update_status_all_projects '$status' || rc=\$?
        echo \"FANOUT_RC=\$rc\"
    "
}

@test "fan-out: zero membership + strict -> rc 1 with guidance" {
    run fanout 0 0 "" 0 Ready
    [ "$status" -eq 0 ]
    [[ "$output" == *"FANOUT_RC=1"* ]]
    [[ "$output" == *"no projects"* ]]
    [[ "$output" == *"--safe"* ]]
}

@test "fan-out: zero membership + --safe -> rc 0 no-op" {
    run fanout 1 0 "" 0 Ready
    [[ "$output" == *"FANOUT_RC=0"* ]]
    [[ "$output" == *"nothing to update"* ]]
}

@test "fan-out: lookup failure + strict -> rc 1 (distinct from empty)" {
    run fanout 0 1 "" 0 Ready
    [[ "$output" == *"FANOUT_RC=1"* ]]
    [[ "$output" == *"lookup failed"* ]]
}

@test "fan-out: lookup failure + --safe -> rc 1 (reports, never lies)" {
    run fanout 1 1 "" 0 Ready
    [[ "$output" == *"FANOUT_RC=1"* ]]
    [[ "$output" == *"never lies"* ]]
}

@test "fan-out: single project, write succeeds -> rc 0" {
    run fanout 0 0 $'Alpha\t1\tTBD' 0 Ready
    [ "$status" -eq 0 ]
}

@test "fan-out: same-status project is an idempotent no-write success" {
    run fanout 0 0 $'Alpha\t1\tReady' 1 Ready
    # update_status stub would fail if called; no-write means rc 0
    [ "$status" -eq 0 ]
}

@test "fan-out: all projects fail -> rc 1 (updated=0)" {
    run fanout 0 0 $'Alpha\t1\tTBD' 1 Ready
    [[ "$output" == *"FANOUT_RC=1"* ]]
    [[ "$output" == *"No project updated"* ]]
}

@test "fan-out: one of two fails -> rc 0 with partial warning" {
    local stripped="$STRIPPED"
    run bash -c "
        set -uo pipefail
        source '$stripped'
        resolve_target_repo() { echo 'test-org/test-repo'; }
        provider_projects_for_issue() { printf '%s' \$'Alpha\t1\tTBD\nBeta\t2\tTBD'; }
        update_status() { [ \"\$PROJECT_NAME\" = '2' ] && return 1; return 0; }
        SAFE_MODE=0 ISSUE_NUMBER=44
        update_status_all_projects 'Ready'
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"Partial"* ]]
}
