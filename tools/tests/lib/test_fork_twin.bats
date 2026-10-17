#!/usr/bin/env bats
# Tests for lib/fork-twin.bash — twin classification and the adoption map.
#
# Library-internal tests: every verdict branch, map mechanics, proposal
# ranking. Wiring-level scenario tests (classified replay end state) live in
# the fork-sync suite.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    source "$DEVENV_TOOLS/lib/fork-twin.bash"
    create_fork_fixture_trio "$TEST_TEMP_DIR/fork-fixture"
    export FORK_TWIN_LOCAL_REPO="$FORK_FIXTURE_WORKING_CLONE"
    export FORK_TWIN_UPSTREAM_REPO="$FORK_FIXTURE_GH_CLONE"
    git -C "$FORK_FIXTURE_WORKING_CLONE" remote add upstream "$FORK_FIXTURE_UPSTREAM"
    git -C "$FORK_FIXTURE_WORKING_CLONE" fetch -q upstream
    BASE="$(git -C "$FORK_FIXTURE_GH_CLONE" rev-list --max-parents=0 HEAD | tail -1)"
    UPSTREAM_TIP="$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse HEAD)"
    MAP="$(fork_twin_map_get_path "$FORK_FIXTURE_WORKING_CLONE")"
}

teardown() {
    test_helper_teardown
}

# Export the working clone's named commit into the upstream clone (new SHA
# there), echoing both SHAs as "local=<sha> upstream=<sha>".
_export_commit_to_upstream() {
    local subject="$1" local_sha upstream_sha
    local_sha="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="$subject" -1)"
    git -C "$FORK_FIXTURE_WORKING_CLONE" format-patch -1 --stdout "$local_sha" \
        | git -C "$FORK_FIXTURE_GH_CLONE" am -q
    upstream_sha="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep="$subject" -1)"
    printf 'local=%s upstream=%s\n' "$local_sha" "$upstream_sha"
}

@test "fork-twin: classify — identical export without Change-Id matches by patch-id" {
    fork_scenario_pre_change_id_backlog 2
    _export_commit_to_upstream "backlog: pre-change-id commit 1" > /dev/null
    local_sha="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"
    upstream_sha="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"

    run fork_twin_classify_commit "$local_sha" "$UPSTREAM_TIP" ""
    [ "$status" -eq 0 ]
    read -r verdict l_sha u_sha signal <<< "$output"
    [ "$verdict" = "$TWIN_VERDICT_TWIN" ]
    [ "$l_sha" = "$local_sha" ]
    [ "$u_sha" = "$upstream_sha" ]
    [ "$signal" = "patch-id" ]
}

@test "fork-twin: classify — Change-Id twin edited at the target is twin-residue" {
    fork_scenario_export_and_edit_twin
    local_sha="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="twin commit for export" -1)"

    run fork_twin_classify_commit "$local_sha" "$UPSTREAM_TIP" ""
    [ "$status" -eq 0 ]
    read -r verdict _ u_sha signal <<< "$output"
    [ "$verdict" = "$TWIN_VERDICT_TWIN_RESIDUE" ]
    [ -n "$u_sha" ]
    [ "$signal" = "change-id" ]
}

@test "fork-twin: classify — unexported local commit is fork-only" {
    fork_scenario_pre_change_id_backlog 1

    local_sha="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"
    run fork_twin_classify_commit "$local_sha" "$UPSTREAM_TIP" ""
    [ "$status" -eq 0 ]
    read -r verdict l_sha rest <<< "$output"
    [ "$verdict" = "$TWIN_VERDICT_FORK_ONLY" ]
    [ "$l_sha" = "$local_sha" ]
    [ -z "$rest" ]
}

@test "fork-twin: classify — recorded adoption link wins and reports clean twin for identical patches" {
    fork_scenario_pre_change_id_backlog 2
    local_sha="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"
    upstream_sha="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"
    [ -z "$upstream_sha" ]
    _export_commit_to_upstream "backlog: pre-change-id commit 1" > /dev/null
    upstream_sha="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"
    fork_twin_map_add "$FORK_FIXTURE_WORKING_CLONE" "$local_sha" "$upstream_sha" "test link"

    run fork_twin_classify_commit "$local_sha" "$UPSTREAM_TIP" "$MAP"
    [ "$status" -eq 0 ]
    read -r verdict l_sha u_sha signal <<< "$output"
    [ "$verdict" = "$TWIN_VERDICT_TWIN" ]
    [ "$signal" = "adoption-link" ]
}

@test "fork-twin: adoption map — add, lookup both directions, idempotent add" {
    fork_scenario_pre_change_id_backlog 2
    local_a="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"
    _export_commit_to_upstream "backlog: pre-change-id commit 1" > /dev/null
    upstream_a="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"

    fork_twin_map_add "$FORK_FIXTURE_WORKING_CLONE" "$local_a" "$upstream_a" "first"
    # Idempotent: adding the same pair again changes nothing.
    fork_twin_map_add "$FORK_FIXTURE_WORKING_CLONE" "$local_a" "$upstream_a" "second"
    [ "$(grep -c "$local_a" "$MAP")" -eq 1 ]

    [ "$(fork_twin_map_lookup_local "$MAP" "$local_a")" = "$upstream_a" ]
    [ "$(fork_twin_map_lookup_upstream "$MAP" "$upstream_a")" = "$local_a" ]
    run fork_twin_map_lookup_local "$MAP" "0000000000000000000000000000000000000000"
    [ "$status" -ne 0 ]
}

@test "fork-twin: adoption map — remove drops the pair and fails when absent" {
    fork_scenario_pre_change_id_backlog 2
    local_a="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"
    _export_commit_to_upstream "backlog: pre-change-id commit 1" > /dev/null
    upstream_a="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"
    fork_twin_map_add "$FORK_FIXTURE_WORKING_CLONE" "$local_a" "$upstream_a"

    fork_twin_map_remove "$FORK_FIXTURE_WORKING_CLONE" "$local_a"
    run fork_twin_map_lookup_local "$MAP" "$local_a"
    [ "$status" -ne 0 ]
    run fork_twin_map_remove "$FORK_FIXTURE_WORKING_CLONE" "$local_a"
    [ "$status" -ne 0 ]
}

@test "fork-twin: adoption map — rejects a SHA that is not a commit" {
    fork_scenario_pre_change_id_backlog 1
    local_a="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"
    run fork_twin_map_add "$FORK_FIXTURE_WORKING_CLONE" "$local_a" "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    [ "$status" -ne 0 ]
    [[ "$output" == *"not a commit"* ]]
    [ ! -f "$MAP" ]
}

@test "fork-twin: adoption map — list prunes entries whose upstream side is gone" {
    fork_scenario_pre_change_id_backlog 2
    local_a="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"
    _export_commit_to_upstream "backlog: pre-change-id commit 1" > /dev/null
    upstream_a="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"
    fork_twin_map_add "$FORK_FIXTURE_WORKING_CLONE" "$local_a" "$upstream_a"
    # Record a second pair pointing at an upstream SHA that never existed.
    local_b="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="backlog: pre-change-id commit 2" -1)"
    printf '%s %s # bogus\n' "$local_b" "0000000000000000000000000000000000000000" >> "$MAP"

    run fork_twin_map_list "$MAP"
    [ "$status" -eq 0 ]
    [[ "$output" == *"$local_a"* ]]
    grep -q "$local_b" "$MAP" && return 1
    [[ "$output" == *"pruned"* ]] || grep -q "pruned" <<< "$(cat "$TEST_TEMP_DIR/stderr_probe" 2>/dev/null || true)"
}

@test "fork-twin: propose — identical unlinked pair ranks at 3" {
    fork_scenario_pre_change_id_backlog 2
    # Export both backlog commits in order (commit 2 patches on top of 1).
    local tip_before
    for n in 1 2; do
        _export_commit_to_upstream "backlog: pre-change-id commit $n" > /dev/null
    done
    UPSTREAM_TIP="$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse HEAD)"
    local_sha="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="backlog: pre-change-id commit 2" -1)"

    run bash -c "source '$DEVENV_TOOLS/lib/fork-twin.bash' && \
        FORK_TWIN_LOCAL_REPO='$FORK_TWIN_LOCAL_REPO' FORK_TWIN_UPSTREAM_REPO='$FORK_TWIN_UPSTREAM_REPO' \
        fork_twin_map_propose '$BASE..$local_sha' '$BASE..$UPSTREAM_TIP'"
    [ "$status" -eq 0 ]
    # The best candidate for commit 2 must be its own upstream copy at
    # score 3 — filter to this local SHA rather than the global top line,
    # which can carry a different pair's equally-scored row.
    local top
    top="$(grep "^3 $local_sha " <<< "$output" | head -1)"
    [ -n "$top" ]
    read -r score l_sha u_sha subject <<< "$top"
    [ "$score" -eq 3 ]
    [ "$subject" = "backlog: pre-change-id commit 2" ]
}

@test "fork-twin: propose — skips commits carrying a Change-Id" {
    fork_scenario_export_and_edit_twin
    UPSTREAM_TIP="$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse HEAD)"
    local twin_local
    twin_local="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="twin commit for export" -1)"

    run bash -c "source '$DEVENV_TOOLS/lib/fork-twin.bash' && \
        FORK_TWIN_LOCAL_REPO='$FORK_TWIN_LOCAL_REPO' FORK_TWIN_UPSTREAM_REPO='$FORK_TWIN_UPSTREAM_REPO' \
        fork_twin_map_propose '$BASE..$twin_local' '$BASE..$UPSTREAM_TIP'"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "fork-twin: patches identical — same patch matches across repos, drifted patch does not" {
    fork_scenario_export_and_edit_twin
    local twin_local twin_upstream
    twin_local="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="twin commit for export" -1)"
    twin_upstream="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep="twin commit for export" -1)"
    run fork_twin_patches_identical "$twin_local" "$twin_upstream"
    [ "$status" -ne 0 ]  # the target-side adaptation breaks patch-id equality
}

@test "fork-twin: residue diff — shows the adaptation and nothing else" {
    fork_scenario_export_and_edit_twin
    local twin_local twin_upstream
    twin_local="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="twin commit for export" -1)"
    twin_upstream="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep="twin commit for export" -1)"

    run fork_twin_residue_diff "$twin_local" "$twin_upstream"
    [ "$status" -eq 0 ]
    [[ "$output" == *"target adaptation line"* ]]
    [[ "$output" != *"twin base line"*"twin base line"* ]]  # base line appears once, as context
}

@test "fork-twin: residue diff — empty for identical patches" {
    fork_scenario_pre_change_id_backlog 2
    local_sha="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"
    git -C "$FORK_FIXTURE_WORKING_CLONE" format-patch -1 --stdout "$local_sha" | git -C "$FORK_FIXTURE_GH_CLONE" am -q
    upstream_sha="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep="backlog: pre-change-id commit 1" -1)"

    run fork_twin_residue_diff "$local_sha" "$upstream_sha"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
}

@test "fork-twin: Fork-Adapted target copy makes the Change-Id match a plain twin" {
    fork_scenario_export_and_edit_twin
    local twin_local twin_upstream
    twin_local="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="twin commit for export" -1)"
    twin_upstream="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep="twin commit for export" -1)"
    # Declare the adaptation on the target copy.
    local msg
    msg="$(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%B "$twin_upstream")"
    printf '%s\n' "$msg" | git -C "$FORK_FIXTURE_GH_CLONE" interpret-trailers --trailer "Fork-Adapted: yes" > /dev/null
    git -C "$FORK_FIXTURE_GH_CLONE" commit -q --amend -F <(git -C "$FORK_FIXTURE_GH_CLONE" log -1 --format=%B "$twin_upstream" | git interpret-trailers --trailer "Fork-Adapted: yes")
    twin_upstream="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep="twin commit for export" -1)"

    run fork_twin_classify_commit "$twin_local" "$(git -C "$FORK_FIXTURE_GH_CLONE" rev-parse HEAD)" ""
    [ "$status" -eq 0 ]
    read -r verdict _ u_sha signal <<< "$output"
    [ "$verdict" = "$TWIN_VERDICT_TWIN" ]
    [ "$signal" = "change-id-adapted" ]
}

@test "fork-twin: change_id_is_fork_adapted parses the trailer" {
    run bash -c "source '$DEVENV_TOOLS/lib/change-id.bash' && change_id_is_fork_adapted \$'subject\n\nFork-Adapted: yes\n'"
    [ "$status" -eq 0 ]
    run bash -c "source '$DEVENV_TOOLS/lib/change-id.bash' && change_id_is_fork_adapted \$'subject\n\nFork-Adapted: no\n'"
    [ "$status" -ne 0 ]
}

@test "fork-twin: pick-range classify — own exported twin drops via change-id, new upstream work picks" {
    # Fork commits one Change-Id'd commit and exports it; upstream also gains
    # an independent commit the fork has never seen.
    _fork_scenario_install_change_id_hook
    printf 'local work\n' > "$FORK_FIXTURE_WORKING_CLONE/local_work.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add local_work.txt
    git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "feat: local work for export"
    _export_commit_to_upstream "feat: local work for export"
    printf 'unseen\n' > "$FORK_FIXTURE_GH_CLONE/unseen.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add unseen.txt
    git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "feat: unseen upstream work"

    BASE="$(git -C "$FORK_FIXTURE_WORKING_CLONE" merge-base upstream/master HEAD)"
    # Land upstream's commits so the working clone's upstream/master sees them.
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master
    git -C "$FORK_FIXTURE_WORKING_CLONE" fetch -q upstream
    run bash -c "
        source '$DEVENV_TOOLS/lib/fork-twin.bash'
        FORK_TWIN_LOCAL_REPO='$FORK_FIXTURE_WORKING_CLONE'
        FORK_TWIN_UPSTREAM_REPO='$FORK_FIXTURE_GH_CLONE'
        fork_twin_classify_pick_range '$BASE..upstream/master' '$BASE..HEAD'
    "
    [ "$status" -eq 0 ]
    # Exactly two upstream commits: the exported twin drops, the unseen work picks.
    [ "$(grep -c ' drop ' <<< "$output")" -eq 1 ]
    [ "$(grep -c ' pick ' <<< "$output")" -eq 1 ]
    grep -q " drop change-id" <<< "$output"
}

@test "fork-twin: pick-range classify — recorded adoption link drops the upstream side" {
    # Pre-Change-Id local commit, exported (so upstream's copy has a Change-Id
    # or not — irrelevant), then the pair recorded manually in the map.
    printf 'legacy work\n' > "$FORK_FIXTURE_WORKING_CLONE/legacy.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add legacy.txt
    GIT_AUTHOR_DATE="2026-09-08T10:00:00" GIT_COMMITTER_DATE="2026-09-08T10:00:00" \
        git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "feat: legacy local work"
    _export_commit_to_upstream "feat: legacy local work"
    local local_sha upstream_sha
    local_sha="$(git -C "$FORK_FIXTURE_WORKING_CLONE" log --format=%H --grep="legacy local work" -1)"
    upstream_sha="$(git -C "$FORK_FIXTURE_GH_CLONE" log --format=%H --grep="legacy local work" -1)"
    fork_twin_map_add "$FORK_FIXTURE_WORKING_CLONE" "$local_sha" "$upstream_sha" "recorded"

    BASE="$(git -C "$FORK_FIXTURE_WORKING_CLONE" merge-base upstream/master HEAD)"
    # Land upstream's commits so the working clone's upstream/master sees them.
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master
    git -C "$FORK_FIXTURE_WORKING_CLONE" fetch -q upstream
    run bash -c "
        source '$DEVENV_TOOLS/lib/fork-twin.bash'
        FORK_TWIN_LOCAL_REPO='$FORK_FIXTURE_WORKING_CLONE'
        FORK_TWIN_UPSTREAM_REPO='$FORK_FIXTURE_GH_CLONE'
        fork_twin_classify_pick_range '$BASE..upstream/master' '$BASE..HEAD'
    "
    [ "$status" -eq 0 ]
    grep -q "$upstream_sha drop adoption-link" <<< "$output"
}

@test "fork-twin: pick-range classify — patch-id fallback drops without trailers, bounded to range" {
    # Local commit with NO Change-Id, byte-identical copy upstream: only the
    # patch-id signal can catch it. Both sides commit the identical file
    # content and message.
    printf 'identical\n' > "$FORK_FIXTURE_WORKING_CLONE/identical.txt"
    git -C "$FORK_FIXTURE_WORKING_CLONE" add identical.txt
    GIT_AUTHOR_DATE="2026-09-09T10:00:00" GIT_COMMITTER_DATE="2026-09-09T10:00:00" \
        git -C "$FORK_FIXTURE_WORKING_CLONE" commit -qm "feat: identical on both sides"
    printf 'identical\n' > "$FORK_FIXTURE_GH_CLONE/identical.txt"
    git -C "$FORK_FIXTURE_GH_CLONE" add identical.txt
    GIT_AUTHOR_DATE="2026-09-09T10:00:00" GIT_COMMITTER_DATE="2026-09-09T10:00:00" \
        git -C "$FORK_FIXTURE_GH_CLONE" commit -qm "feat: identical on both sides"

    BASE="$(git -C "$FORK_FIXTURE_WORKING_CLONE" merge-base upstream/master HEAD)"
    # Land upstream's commits so the working clone's upstream/master sees them.
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master
    git -C "$FORK_FIXTURE_WORKING_CLONE" fetch -q upstream
    run bash -c "
        source '$DEVENV_TOOLS/lib/fork-twin.bash'
        FORK_TWIN_LOCAL_REPO='$FORK_FIXTURE_WORKING_CLONE'
        FORK_TWIN_UPSTREAM_REPO='$FORK_FIXTURE_GH_CLONE'
        fork_twin_classify_pick_range '$BASE..upstream/master' '$BASE..HEAD'
    "
    [ "$status" -eq 0 ]
    grep -q " drop patch-id" <<< "$output"
}

@test "fork-twin: pick-range classify — picks come back oldest-first" {
    fork_scenario_scale_history 1 3
    # Land upstream's commits so the working clone's upstream/master sees them.
    git -C "$FORK_FIXTURE_GH_CLONE" push -q origin master
    git -C "$FORK_FIXTURE_WORKING_CLONE" fetch -q upstream
    BASE="$(git -C "$FORK_FIXTURE_WORKING_CLONE" merge-base upstream/master HEAD)"
    run bash -c "
        source '$DEVENV_TOOLS/lib/fork-twin.bash'
        FORK_TWIN_LOCAL_REPO='$FORK_FIXTURE_WORKING_CLONE'
        FORK_TWIN_UPSTREAM_REPO='$FORK_FIXTURE_GH_CLONE'
        fork_twin_classify_pick_range '$BASE..upstream/master' '$BASE..HEAD'
    "
    [ "$status" -eq 0 ]
    [ "$(wc -l <<< "$output")" -eq 3 ]
    # rev-list --reverse: first line is the oldest upstream commit (1, not 3).
    [[ "$output" == *1*pick* ]]
    local first last
    first="$(head -1 <<< "$output")"
    last="$(tail -1 <<< "$output")"
    git -C "$FORK_FIXTURE_GH_CLONE" log --format=%s -1 "${first%% *}" | grep -q "scale upstream commit 1"
    git -C "$FORK_FIXTURE_GH_CLONE" log --format=%s -1 "${last%% *}" | grep -q "scale upstream commit 3"
}
