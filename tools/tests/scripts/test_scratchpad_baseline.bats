#!/usr/bin/env bats
# Baseline behavior locks for tools that the scratchpad mode (Plan-004) will
# later restrict: their pre-scratchpad observable behavior is locked here so
# the Phase 3 refusal wiring is a provable delta.

bats_require_minimum_version 1.5.0
load ../test_helper

@test "baseline: repo-commit refuses option-shaped args (exit 1, refusal message)" {
    run "$DEVENV_TOOLS/repo-commit" -m "should be refused"
    [ "$status" -eq 1 ]
    [[ "$output" == *"options are refused by design"* ]]
}

@test "baseline: repo-commit refuses --yes (exit 1)" {
    run "$DEVENV_TOOLS/repo-commit" --yes
    [ "$status" -eq 1 ]
}

@test "baseline: git-wip refuses unknown flags (exit 1)" {
    run "$DEVENV_TOOLS/git-wip" --definitely-not-a-flag
    [ "$status" -eq 1 ]
    [[ "$output" == *"unknown flag"* ]]
}

@test "baseline: pr-create refuses unknown flags (exit 2)" {
    run "$DEVENV_TOOLS/pr-create" --definitely-not-a-flag
    [ "$status" -eq 2 ]
}

@test "baseline: repo-commit editor-abort path — emptied message means no commit" {
    # Pin an interactive-shaped MOCK editor (a script is honored; bare `true`
    # is treated as unset and falls through — in this dev container the chain
    # can reach `code --wait` and open a real editor tab, so tests must never
    # rely on "no editor available"). The mock empties the message file: the
    # documented abort path (editor emptied -> no commit).
    test_helper_setup
    local repo="$TEST_TEMP_DIR/baseline-repo"
    create_mock_git_repo "$repo"
    cd "$repo"
    local mock_editor="$TEST_TEMP_DIR/mock-editor.sh"
    printf '#!/bin/bash\n: > "$1"\n' > "$mock_editor"
    chmod +x "$mock_editor"
    echo change >> README.md
    git add README.md
    local before
    before=$(git rev-list --count HEAD)
    run env GIT_EDITOR="$mock_editor" "$DEVENV_TOOLS/repo-commit" "msg"
    [ "$status" -ne 0 ]
    local after
    after=$(git rev-list --count HEAD)
    [ "$after" -eq "$before" ]
}
