#!/usr/bin/env bats
# Identity-resolution docs match the code: the org comes from POLICY_ORG, then the
# neutral `[organization] org` key (and the .setup seed in the provider accessor).
# The GitHub-branded `github_org` key and the `GH_ORG` env var are NOT read.

bats_require_minimum_version 1.5.0

load ../test_helper

@test "no doc claims the github_org config key still resolves" {
    hits="$(grep -n 'github_org' "$PROJECT_ROOT"/docs/*.md | grep -viE 'not read|never read|ignored|no longer|is not' || true)"
    [ -z "$hits" ] || { echo "$hits"; false; }
}

@test "policy docs and contract comment list no GH_ORG leg in the org chain" {
    hits="$(grep -n 'GH_ORG' "$PROJECT_ROOT/tools/lib/policy/README.md" "$PROJECT_ROOT/tools/lib/policy/identity-policy.bash" | grep -viE 'ignored|not read|no longer' || true)"
    [ -z "$hits" ] || { echo "$hits"; false; }
}

@test "a config carrying only github_org does not resolve an org" {
    printf '[organization]\nname=t\ngithub_org=old-org\n' > "$TEST_TEMP_DIR/devenv.config"
    run bash -c "
        export DEVENV_ROOT='$TEST_TEMP_DIR'
        unset POLICY_ORG GH_ORG
        source '$PROJECT_ROOT/tools/lib/policy/policy-core.bash'
        policy_core_init '$TEST_TEMP_DIR/devenv.config'
        source '$PROJECT_ROOT/tools/lib/policy/identity-policy.bash'
        policy_org
    "
    [ "$status" -eq 1 ]
    [ -z "$output" ]
}

@test "GH_ORG in the environment does not override the configured org" {
    printf '[organization]\nname=t\norg=cfg-org\n' > "$TEST_TEMP_DIR/devenv.config"
    run bash -c "
        export DEVENV_ROOT='$TEST_TEMP_DIR'
        unset POLICY_ORG
        source '$PROJECT_ROOT/tools/lib/policy/policy-core.bash'
        policy_core_init '$TEST_TEMP_DIR/devenv.config'
        source '$PROJECT_ROOT/tools/lib/policy/identity-policy.bash'
        GH_ORG=env-org policy_org
    "
    [ "$status" -eq 0 ]
    [ "$output" = "cfg-org" ]
}

@test "no functional file hard-codes the upstream organization's name (attribution headers and LICENSE aside)" {
    cd "$PROJECT_ROOT"
    run bash -c "grep -rniI 'workinprogress' tools/lib tools/scripts tools/config tools/templates .devcontainer .vscode copilot docs README.md package.json 2>/dev/null \
        | grep -viE '# Author:|\"author\"|work-in-progress|work in progress|workinprogress-ai/devenv.git\"' \
        | grep -v 'tools/cache'"
    [ -z "$output" ] || { echo "$output"; false; }
}
