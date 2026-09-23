#!/usr/bin/env bats
# Loading-contract tests: every lib entry point must provide the provider
# verbs its callers use, through the one canonical loader (provider_load).
# These are clean-shell composition tests — the harness that catches loader
# drift (the auth-module gap class of bug) instead of letting scripts fail
# at runtime.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    unset _PROVIDER_CORE_LOADED _PROVIDER_TOKENS_LOADED || true
}

@test "provider_load: core-only call detects and defines seam verbs" {
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/providers/provider-core.bash
provider_load" \
        provider_detect provider_secret_get provider_load
}

@test "provider_load: sources requested modules from the active provider" {
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/providers/provider-core.bash
provider_load issues prs auth" \
        provider_issues_list provider_prs_list provider_auth_status_impl
}

@test "provider_load: absent module is skipped with a warning, not an error" {
    local out
    out=$(env DEVENV_ROOT="$DEVENV_ROOT" DEVENV_TOOLS="$DEVENV_TOOLS" \
        bash -c "source $DEVENV_TOOLS/lib/providers/provider-core.bash && provider_load issues nonexistent_module" 2>&1)
    [ "$status" -eq 0 ] 2>/dev/null || true
    # bash -c above runs in a subshell via $(); use run instead for the rc.
    run env DEVENV_ROOT="$DEVENV_ROOT" DEVENV_TOOLS="$DEVENV_TOOLS" \
        bash -c "source $DEVENV_TOOLS/lib/providers/provider-core.bash && provider_load issues nonexistent_module"
    [ "$status" -eq 0 ]
    [[ "$out" == *"nonexistent_module"*"skipped"* ]]
}

@test "loader: provider-loader provides the full facade incl. auth lifecycle" {
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/provider-loader.bash" \
        provider_issues_list provider_prs_list provider_repos_view \
        provider_pipelines_run_list provider_projects_list \
        provider_org_releases_list provider_auth_status_impl
}

@test "loader: every migrated lib provides its domain verbs" {
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/issue-graph.bash" \
        provider_issues_list provider_repos_view
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/issues-config.bash" \
        provider_org_issue_types
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/artifact-operations.bash" \
        provider_repos_view
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/repo-types.bash" \
        provider_repos_view provider_org_rulesets_list
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/repo-operations.bash" \
        provider_repos_list provider_git_transport_url
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/pr-events.bash" \
        provider_prs_view
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/issue-operations.bash" \
        provider_issues_list provider_issues_set_type
}

@test "loader: key-update-git sources the auth lifecycle via provider_load" {
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/providers/provider-core.bash
provider_load auth" \
        provider_auth_import_token_impl provider_auth_status_impl
}

@test "loader: only the canonical idiom remains (no per-lib module sourcing)" {
    # The guarded per-lib detect+source blocks are retired; direct module
    # sourcing outside provider-core/provider_load is the drift vector that
    # caused the auth-loading gap. Whitespace-tolerant: matches the sourcing
    # pattern regardless of line wrapping.
    local violations
    violations=$(grep -rn --include='*.bash' --include='*.sh' \
        -E 'source .*providers/\$\{PROVIDER_NAME\}' \
        "$DEVENV_TOOLS/lib" "$DEVENV_TOOLS/scripts" 2>/dev/null \
        | grep -v '/cache/' \
        | grep -v 'providers/provider-core.bash' || true)
    [ -z "$violations" ] || {
        echo "direct module sourcing outside the canonical loader:" >&2
        printf '%s\n' "$violations" >&2
        return 1
    }
}

@test "loader: provider missing a module fails defined at call sites (no crash)" {
    # A provider directory without the requested module still loads core;
    # the verb is simply undefined — callers get the standard "does not
    # implement" failure instead of a sourcing crash.
    run env DEVENV_ROOT="$DEVENV_ROOT" DEVENV_TOOLS="$DEVENV_TOOLS" \
        bash -c 'source "'"$DEVENV_TOOLS"'/lib/providers/provider-core.bash" && provider_load nonexistent_domain && declare -F provider_detect >/dev/null && ! declare -F provider_nonexistentdomain_anything >/dev/null'
    [ "$status" -eq 0 ]
}

@test "loader: bootstrap seam shape (core + auth only) provides the lifecycle" {
    compose_functions_defined \
        "source $DEVENV_TOOLS/lib/providers/provider-core.bash
provider_load auth" \
        provider_auth_status provider_auth_status_impl provider_auth_import_token provider_auth_import_token_impl
}

@test "facade arg order: repo-args position is family-consistent (F031 lock)" {
    # Canonical order by family: view-style verbs (number-first CLIs) emit
    # repo_args trailing; list/action verbs emit repo_args leading. The
    # lock: no verb mixes both forms, and the view family stays trailing.
    local src
    src=$(grep -h 'gh issue view "$@" "\${repo_args\[@\]}"\|gh pr view "$@" "\${repo_args\[@\]}"' \
        "$DEVENV_TOOLS/lib/providers/github/issues.bash" \
        "$DEVENV_TOOLS/lib/providers/github/prs.bash" | wc -l)
    [ "$src" -eq 2 ]
    local leading
    leading=$(grep -hE 'gh (issue|pr|run|workflow|label) [a-z]+ "\$\{repo_args\[@\]\}"' \
        "$DEVENV_TOOLS/lib/providers/github/"*.bash | wc -l)
    [ "$leading" -ge 8 ]
}
