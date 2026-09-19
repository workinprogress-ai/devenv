#!/usr/bin/env bash
# Live-test helpers for gated GitHub Projects API tests.
#
# Live tests hit the real GitHub Projects API against a designated scratch
# project. They run ONLY when RUN_LIVE_TESTS=1 is set; the default suite
# stays hermetic. Live tests create/update/delete only their own uniquely
# named test items and always tear them down.

# Gate: skip the calling file entirely when live tests are not enabled.
live_tests_enabled() {
    [ "${RUN_LIVE_TESTS:-0}" = "1" ]
}

# Skip helper for use at the top of a live @test:
#   skip_if_live_disabled
skip_if_live_disabled() {
    if ! live_tests_enabled; then
        skip "RUN_LIVE_TESTS!=1 - live GitHub Projects tests disabled"
    fi
}

# Require the scratch project to be configured.
# The scratch project lives in the org (not a personal namespace) so org PAT
# scoping works for the PR-hook integration later.
require_scratch_project() {
    if [ -z "${SCRATCH_PROJECT:-}" ]; then
        fail "SCRATCH_PROJECT env var not set (name of the org scratch project, e.g. tooling-scratch)"
    fi
}

# Unique test-item marker so teardown can find and remove exactly what the
# test created, never real items.
live_test_marker() {
    echo "devenv-live-test-$$-$(date +%s)"
}
