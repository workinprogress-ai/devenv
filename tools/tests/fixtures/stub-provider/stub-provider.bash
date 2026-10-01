#!/usr/bin/env bash
# stub-provider.bash — call-shape conformance fixture.
#
# Captures the arguments a neutral call site passes to a provider_* verb so
# a bats assertion can classify the shape (positional spec, -R flag dialect,
# arity) without any transport. The canonical verbs are overridden with
# arg-echoing stubs; captured args land in CAPTURED_ARGS (newline-separated)
# for string assertions.
#
# This is test infrastructure, not throwaway scaffolding: it is the
# enforcement mechanism for call-site parity between providers.

# Args the most recent stubbed call received (newline-separated).
CAPTURED_ARGS=""

provider_seam_reset() {
    CAPTURED_ARGS=""
}

# Internal: record args for the sourcing shell's assertions.
# shellcheck disable=SC2034  # CAPTURED_ARGS is read by test files, not here
_provider_seam_capture() {
    CAPTURED_ARGS="$*"
}

# Install a capturing stub for a verb. The stub records its args and
# succeeds (unless the verb's contract requires failing shapes — handled
# by specific tests overriding further).
provider_seam_stub() {
    local verb="$1"
    eval "${verb}() { _provider_seam_capture \"\$@\"; }"
    export -f "${verb?}" 2>/dev/null || true
}

# The canonical repo-targeting verbs exercised by neutral wrappers. Each
# conformance case stubs the ones its call shape touches.
provider_seam_install_repo_verbs() {
    local verb
    for verb in \
        provider_issues_list provider_issues_view provider_issues_create \
        provider_issues_edit provider_issues_close provider_issues_reopen \
        provider_issues_exists provider_issues_comment provider_issues_comments \
        provider_issues_comment_add provider_issues_comment_get \
        provider_issues_comment_edit provider_issues_label_list \
        provider_issues_label_create provider_issues_label_update \
        provider_issues_label_ensure provider_issues_milestones \
        provider_prs_list provider_prs_view provider_prs_create \
        provider_prs_diff provider_prs_comment provider_prs_merge \
        provider_prs_thread_create provider_prs_thread_reply \
        provider_prs_threads_page provider_prs_thread_resolve \
        provider_repos_view provider_repos_list provider_repos_create \
        provider_repos_default_branch provider_pipelines_workflow_list \
        provider_pipelines_run_list provider_pipelines_run_view; do
        provider_seam_stub "$verb"
    done
}
