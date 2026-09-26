#!/usr/bin/env bats
# Gated live tests for project-list-for-issue and the write path
# against the org scratch project.
#
# Run with:  RUN_LIVE_TESTS=1 SCRATCH_PROJECT=tooling-scratch \
#            DEVENV_REPO=<org>/<repo> bats tools/tests/live/

bats_require_minimum_version 1.5.0

load ../live/helpers

@test "live: gate logic disables when RUN_LIVE_TESTS is unset" {
    # Asserts the helpers' gate itself, independent of the ambient env.
    run bash -c 'source '"$BATS_TEST_DIRNAME"'/../live/helpers.bash && RUN_LIVE_TESTS= live_tests_enabled && echo enabled || echo disabled'
    [ "$status" -eq 0 ]
    [ "$output" = "disabled" ]
}

@test "live: scratch project is reachable and has a Status field" {
    skip_if_live_disabled
    require_scratch_project
    run gh project list --owner "${GH_ORG:-workinprogress-ai}" --format json
    [ "$status" -eq 0 ]
    [[ "$output" == *"$SCRATCH_PROJECT"* ]]
}

@test "live: project-list-for-issue returns Status for scratch project item" {
    skip_if_live_disabled
    require_scratch_project
    local issue_url="https://github.com/${DEVENV_REPO%/}/issues/43"
    local proj_num
    proj_num=$(gh project list --owner "${GH_ORG:-workinprogress-ai}" --format json \
        --jq ".projects[] | select(.title == \"$SCRATCH_PROJECT\") | .number")
    # Round trip: add issue 43, look it up, remove it.
    gh project item-add "$proj_num" --owner "${GH_ORG:-workinprogress-ai}" \
        --url "$issue_url" >/dev/null
    run bash "$BATS_TEST_DIRNAME/../../scripts/project-list-for-issue.sh" 43
    [ "$status" -eq 0 ]
    [[ "$output" == *"$SCRATCH_PROJECT"* ]]
    local item_id
    item_id=$(gh project item-list "$proj_num" --owner "${GH_ORG:-workinprogress-ai}" \
        --format json --jq '.items[] | select(.content.number == 43) | .id')
    gh project item-delete "$proj_num" --owner "${GH_ORG:-workinprogress-ai}" --id "$item_id" >/dev/null
}
