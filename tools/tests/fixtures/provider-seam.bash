#!/usr/bin/env bash
# provider-seam.bash — provider-seam test harness (beachhead).
#
# Neutral-layer tests historically mock the `gh` CLI directly. That couples
# the suite to the github provider's transport: under any other provider the
# neutral code calls provider_* verbs backed by different machinery, and the
# mock never fires. The provider seam — not the CLI — is the stable boundary
# the neutral layer actually names.
#
# Usage: source this fixture, then declare stubs for the provider_* verbs
# your test exercises:
#
#   load ../fixtures/provider-seam
#   provider_seam_stub provider_repos_view 'echo "test-org/test-repo"'
#   run get_full_repo_name "$some_dir"   # neutral code under test
#
# The stub installs a exported function visible to child bash -c shells
# (the pattern the gh-mocking tests already use — same mechanics, correct
# seam). Migration of existing suites is incremental; this file is the
# beachhead (audit F014): new neutral-layer tests stub here, existing suites
# migrate as they are touched.

provider_seam_stub() {
    local verb="$1"
    local body="$2"
    # shellcheck disable=SC2163
    # (exporting the NAMED function is the point)
    eval "${verb}() { ${body}; }"
    export -f "${verb?}"
}
