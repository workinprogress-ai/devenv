#!/usr/bin/env bats
# Provider capability hooks: provider-shaped requirements answered by the
# provider seam, not by callers assuming one provider's shape.
#
# Contract (tools/lib/providers/CONTRACT.md):
#   provider_issues_target_required
#     "yes" when the provider's issue verbs need a repository identity
#     (github: work items live in a repo), "no" when they do not
#     (azure: work items live in org/project from config). Core default: yes.
#   provider_issues_set_type_context
#     Emits "owner name" (two whitespace-separated fields) that the
#     set-type verb's positional signature expects. Core default resolves
#     them from the repo spec via provider_repos_view; azure emits the
#     configured org/project and its verb ignores them.

bats_require_minimum_version 1.5.0

load ../test_helper

@test "capability: provider_issues_target_required defaults to yes with no override" {
    run bash -c "
        source \"\$DEVENV_TOOLS/lib/providers/provider-core.bash\"
        PROVIDER_NAME=github
        provider_load issues
        provider_issues_target_required
    "
    [ "$status" -eq 0 ]
    [ "$output" = "yes" ]
}

@test "capability: azure overrides target-required to no" {
    run bash -c "
        source \"\$DEVENV_TOOLS/lib/providers/provider-core.bash\"
        PROVIDER_NAME=azure
        provider_load issues
        provider_issues_target_required
    "
    [ "$status" -eq 0 ]
    [ "$output" = "no" ]
}

@test "capability: github set-type context resolves owner/name via repos_view" {
    run bash -c "
        source \"\$DEVENV_TOOLS/lib/providers/provider-core.bash\"
        PROVIDER_NAME=github
        provider_load issues repos
        provider_repos_view() {
            case \"\$3\" in
                owner) printf 'the-owner' ;;
                name) printf 'the-repo' ;;
            esac
        }
        provider_issues_set_type_context org/repo
    "
    [ "$status" -eq 0 ]
    [ "$output" = "the-owner the-repo" ]
}

@test "capability: azure set-type context emits configured org/project without repos_view" {
    run bash -c "
        source \"\$DEVENV_TOOLS/lib/providers/provider-core.bash\"
        PROVIDER_NAME=azure
        provider_load issues repos
        provider_repos_view() { echo 'UNEXPECTED repos_view call'; return 1; }
        azure_config_get() {
            case \"\$2\" in
                azure_org) printf 'the-org' ;;
                azure_project) printf 'the-project' ;;
            esac
        }
        provider_issues_set_type_context ignored/repo
    "
    [ "$status" -eq 0 ]
    [ "$output" = "the-org the-project" ]
}
