#!/usr/bin/env bats
# Characterization tests for current policy behavior.
#
# Lock the org's policy decisions as they behave TODAY, before they move to
# tools/lib/policy/ (Plan-issue-39-001). These pin observable outputs so the
# extraction can prove value-preservation:
#   - normalize_issue_type: canonical set + case-insensitivity + story alias
#     (the alias is dropped by that plan — its assertion flips there)
#   - triage label literals: needs-grooming / status:ready
#   - workflow fallback: unreadable child status counts as Ready
#   - provider default: empty [provider] name falls back to github
#
# When policy extraction lands, these assertions must keep passing with the
# values now sourced from the policy library.

bats_require_minimum_version 1.5.0

load ../test_helper

# ============================================================================
# normalize_issue_type — current hardcoded policy (moves to policy lib in P3)
# ============================================================================

@test "characterize: normalize_issue_type canonical Bug case-insensitive" {
    source "$PROJECT_ROOT/tools/lib/issue-operations.bash"
    run normalize_issue_type "bug"
    [ "$status" -eq 0 ]
    [ "$output" = "Bug" ]
    run normalize_issue_type "BUG"
    [ "$status" -eq 0 ]
    [ "$output" = "Bug" ]
    run normalize_issue_type "Bug"
    [ "$status" -eq 0 ]
    [ "$output" = "Bug" ]
}

@test "characterize: normalize_issue_type canonical Feature/Task/Epic" {
    source "$PROJECT_ROOT/tools/lib/issue-operations.bash"
    run normalize_issue_type "feature"
    [ "$status" -eq 0 ]
    [ "$output" = "Feature" ]
    run normalize_issue_type "task"
    [ "$status" -eq 0 ]
    [ "$output" = "Task" ]
    run normalize_issue_type "epic"
    [ "$status" -eq 0 ]
    [ "$output" = "Epic" ]
}

@test "policy: normalize_issue_type rejects the story alias" {
    source "$PROJECT_ROOT/tools/lib/issue-operations.bash"
    run normalize_issue_type "story"
    [ "$status" -eq 1 ]
}

@test "characterize: normalize_issue_type invalid input fails with type vocabulary" {
    source "$PROJECT_ROOT/tools/lib/issue-operations.bash"
    run normalize_issue_type "nonsense"
    [ "$status" -eq 1 ]
    [[ "$output" =~ "Invalid issue type" ]]
    [[ "$output" =~ "must be one of:" ]]
    [[ "$output" =~ "Bug Feature Task Epic" ]]
}

# ============================================================================
# Triage label literals (issue-triage.sh) — policy values to extract in P3
# ============================================================================

@test "policy: triage labels resolve through the policy layer" {
    # The triage tool is TS now; its wizard (the only consumer of the triage
    # labels) is deferred, so the policy literals stay in issue-policy.bash
    # for the wizard's return. The TS tool must not hardcode them.
    grep -q 'needs-grooming' "$PROJECT_ROOT/tools/lib/policy/issue-policy.bash"
    grep -q 'status:ready' "$PROJECT_ROOT/tools/lib/policy/issue-policy.bash"
    ! grep -qE 'needs-grooming|status:ready' "$PROJECT_ROOT/tools/ts/issue-triage.ts"
}

@test "policy: labels-config.yml declares status:ready (honesty gap closed)" {
    # The label triage applies is now declared in the seed vocabulary.
    grep -q "status:ready" "$PROJECT_ROOT/tools/config/labels-config.yml"
}

# ============================================================================
# Workflow fallback (workflow-core.bash) — Ready fallback policy
# ============================================================================

@test "policy: workflow fallback + delivery anchor resolve via policy accessors" {
    # The TS graph consumes the knobs through config keys with the same
    # defaults; the bash policy module keeps the literals for its stay-bash
    # consumers.
    local graph="$PROJECT_ROOT/tools/lib/domain/issues/graph.ts"
    grep -q 'delivery_segment_anchor' "$graph"
    grep -q 'status_fallback' "$graph"
    grep -q 'Implementing' "$PROJECT_ROOT/tools/lib/policy/workflow-policy.bash"
    grep -q 'Ready' "$PROJECT_ROOT/tools/lib/policy/workflow-policy.bash"
}

# ============================================================================
# Provider default (provider-core.bash) — github fallback policy
# ============================================================================

@test "characterize: provider_detect falls back to github when config has no [provider] name" {
    local t
    t=$(mktemp -d)
    printf '# no provider section\n[organization]\nname=test\n' > "$t/devenv.config"
    run bash -c "
        export DEVENV_ROOT='$t'
        source '$PROJECT_ROOT/tools/lib/providers/provider-core.bash'
        provider_detect '$t/devenv.config'
        echo \"\$PROVIDER_NAME\"
    "
    [ "$status" -eq 0 ]
    [ "$output" = "github" ]
    rm -rf "$t"
}

@test "characterize: provider_detect with DEVENV_ROOT unset resolves the checkout's own config" {
    # Regression (fork report): an unset DEVENV_ROOT used to build
    # /devenv.config — nonexistent everywhere — so detection silently took
    # the default path even on forks whose config sets a non-default
    # provider. The no-env default must be the checkout's own devenv.config.
    local t
    t=$(mktemp -d)
    mkdir -p "$t/lib/providers"
    cp "$PROJECT_ROOT/tools/lib/providers/provider-core.bash" "$t/lib/providers/"
    # The lib sources its INI reader from its own parent directory, and the
    # shipped-provider check iterates the providers dir — mirror both.
    cp "$PROJECT_ROOT/tools/lib/config-reader.bash" "$t/lib/"
    ln -s "$PROJECT_ROOT/tools/lib/providers/github" "$t/lib/providers/github"
    ln -s "$PROJECT_ROOT/tools/lib/providers/azure" "$t/lib/providers/azure"
    ln -s "$PROJECT_ROOT/tools/lib/providers/provider-core.bash" "$t/lib/providers/provider-core.bash" 2>/dev/null || true
    printf '[provider]\nname=azure\n' > "$t/devenv.config"
    run bash -c "
        cd '$t'
        unset DEVENV_ROOT
        source '$t/lib/providers/provider-core.bash'
        provider_detect >/dev/null 2>&1
        echo \"\$PROVIDER_NAME\"
    "
    [ "$status" -eq 0 ]
    [ "$output" = "azure" ]
    rm -rf "$t"
}

# ============================================================================
# policy_org chain lock: the POLICY_ORG -> config org precedence must
# hold regardless of whether the config leg resolves directly or through the
# provider accessor. No env var other than POLICY_ORG participates.
# ============================================================================

policy_org_lock_env() {
    # Isolate: policy chain precedence requires each leg unset/cleared in order.
    unset POLICY_ORG GH_ORG
    rm -f "$TEST_TEMP_DIR/devenv.config"
    printf '[organization]\nname=t\norg=%s\n' "$1" > "$TEST_TEMP_DIR/devenv.config"
    export DEVENV_ROOT="$TEST_TEMP_DIR"
    export DEVENV_ROOT_SET=1
}

@test "characterize: policy_org config leg resolves org" {
    policy_org_lock_env cfg-org
    run bash -c "
        set -e
        export DEVENV_ROOT='$TEST_TEMP_DIR'
        source '$PROJECT_ROOT/tools/lib/policy/policy-core.bash'
        policy_core_init '$TEST_TEMP_DIR/devenv.config'
        source '$PROJECT_ROOT/tools/lib/policy/identity-policy.bash'
        policy_org
    "
    [ "$status" -eq 0 ]
    [ "$output" = "cfg-org" ]
}

@test "characterize: policy_org GH_ORG env has no effect (config wins)" {
    run bash -c "
        set -e
        unset POLICY_ORG
        printf '[organization]\nname=t\norg=cfg-org\n' > '$TEST_TEMP_DIR/devenv.config'
        export DEVENV_ROOT='$TEST_TEMP_DIR'
        source '$PROJECT_ROOT/tools/lib/policy/policy-core.bash'
        policy_core_init '$TEST_TEMP_DIR/devenv.config'
        source '$PROJECT_ROOT/tools/lib/policy/identity-policy.bash'
        GH_ORG=env-org policy_org
    "
    [ "$status" -eq 0 ]
    [ "$output" = "cfg-org" ]
}

@test "characterize: policy_org POLICY_ORG outranks everything" {
    run bash -c "
        set -e
        printf '[organization]\nname=t\ngithub_org=cfg-org\n' > '$TEST_TEMP_DIR/devenv.config'
        export DEVENV_ROOT='$TEST_TEMP_DIR'
        source '$PROJECT_ROOT/tools/lib/policy/policy-core.bash'
        policy_core_init '$TEST_TEMP_DIR/devenv.config'
        source '$PROJECT_ROOT/tools/lib/policy/identity-policy.bash'
        POLICY_ORG=policy-org GH_ORG=env-org policy_org
    "
    [ "$status" -eq 0 ]
    [ "$output" = "policy-org" ]
}

@test "characterize: policy_org fails rc=1 when all legs unresolvable" {
    run bash -c "
        set -e
        unset POLICY_ORG GH_ORG
        printf '[organization]\nname=t\n' > '$TEST_TEMP_DIR/devenv.config'
        export DEVENV_ROOT='$TEST_TEMP_DIR'
        source '$PROJECT_ROOT/tools/lib/policy/policy-core.bash'
        policy_core_init '$TEST_TEMP_DIR/devenv.config'
        source '$PROJECT_ROOT/tools/lib/policy/identity-policy.bash'
        policy_org
    "
    [ "$status" -ne 0 ]
}
