#!/usr/bin/env bats
# Contract tests for provider-core.bash.
# Green here means: detection, dispatch guard, auth seam, capability flags,
# and the error contract behave as the facade contract specifies.
# Contract tests for domain facades landing in Phases 3-4 are declared red
# (registered at the bottom) under the plan's milestone-green policy.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

assert_success() {
    [ "$status" -eq 0 ]
}

assert_failure() {
    [ "$status" -ne 0 ]
}

setup() {
    test_helper_setup
    export STUB_CALL_LOG
    export TEST_TEMP_DIR
    # DEVENV_TOOLS must point at this checkout's tools/ for provider lib sourcing.
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    unset _PROVIDER_CORE_LOADED
    unset PROVIDER_NAME
    unset PROVIDER_CAPABILITIES
}

source_core() {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
}

write_config() {
    printf '%s\n' "$@" > "$TEST_TEMP_DIR/devenv.config"
    echo "$TEST_TEMP_DIR/devenv.config"
}

@test "scaffold: cli-stubs fixture loads and stub_gh serves canned api response" {
    stub_gh
    printf '[{"id": 1, "body": "doc_id: x"}]' > "$TEST_TEMP_DIR/api.json"
    export STUB_GH_API_RESPONSE="$TEST_TEMP_DIR/api.json"
    run gh api "repos/o/r/issues/1/comments"
    assert_success
    [[ "$output" == *'"doc_id: x"'* ]]
}

@test "scaffold: stub_gh records invocation argv to the call log" {
    stub_gh
    run gh issue list --state open
    assert_success
    [[ "$(stub_call_count gh)" -eq 1 ]]
    grep -q "^gh issue list --state open$" "$STUB_CALL_LOG"
}

@test "scaffold: stub_gh failure mode propagates" {
    stub_gh
    STUB_GH_FAIL=1 run gh repo view
    assert_failure
}

@test "scaffold: providers library directory exists with expected layout" {
    [ -d "$DEVENV_TOOLS/lib/providers" ]
    [ -f "$DEVENV_TOOLS/lib/providers/README.md" ]
}

# ============================================================================
# Detection
# ============================================================================

@test "detect: defaults to github when no config file exists" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    [ "$PROVIDER_NAME" = "github" ]
}

@test "detect: reads [provider] name from devenv.config" {
    source_core
    local cfg
    cfg=$(write_config "[provider]" "name=azure")
    provider_detect "$cfg"
    [ "$PROVIDER_NAME" = "azure" ]
}

@test "detect: defaults to github when [provider] section is absent" {
    source_core
    local cfg
    cfg=$(write_config "[organization]" "name=foo")
    provider_detect "$cfg"
    [ "$PROVIDER_NAME" = "github" ]
}

@test "detect: defaults to github when name key is empty" {
    source_core
    local cfg
    cfg=$(write_config "[provider]" "name=")
    provider_detect "$cfg"
    [ "$PROVIDER_NAME" = "github" ]
}

@test "detect: tolerates comments and blank lines around the key" {
    source_core
    local cfg
    cfg=$(write_config "# comment" "" "[provider]" "# name comment" "  name = github  " "[other]" "name=wrong")
    # Direct call: provider_detect sets PROVIDER_NAME in the caller's scope,
    # which `run` (a subshell) would discard.
    provider_detect "$cfg"
    [ "$PROVIDER_NAME" = "github" ]
}

@test "module_dir: returns provider module path after detection" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    [ "$(provider_module_dir)" = "$DEVENV_TOOLS/lib/providers/github" ]
}

@test "module_dir: fails before detection has run" {
    source_core
    run provider_module_dir
    assert_failure
}

# ============================================================================
# Credential lifecycle seam (auth import/status)
# ============================================================================

@test "lifecycle: import_token fails defined when provider module is absent" {
    # core without any auth module loaded: the import has no implementation and
    # fails with the defined error.
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    run provider_auth_import_token <<< "tok"
    assert_failure
}

@test "lifecycle: status fails defined when provider module is absent" {
    source_core
    provider_detect "$TEST_TEMP_DIR/absent.config"
    run provider_auth_status
    assert_failure
}

# ============================================================================
# Identity accessors: org/user resolution with env override first, raw
# config second, seed file third. Raw reads only — config template
# expansion must never re-enter these accessors.
# ============================================================================

provider_accessor_setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    unset _PROVIDER_CORE_LOADED PROVIDER_NAME _PROVIDER_GITHUB_URLS_LOADED
    unset GH_ORG GH_USER POLICY_ORG
    export DEVENV_ROOT="$TEST_TEMP_DIR"
    export DEVENV_ROOT_SET=1
    rm -f "$TEST_TEMP_DIR/devenv.config"
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    provider_detect "$TEST_TEMP_DIR/absent.config"
}

@test "provider_org_get: GH_ORG env has no effect (no env leg)" {
    provider_accessor_setup
    printf '[organization]\nname=t\norg=cfg-org\n' > "$TEST_TEMP_DIR/devenv.config"
    run bash -c "
        export DEVENV_ROOT='$TEST_TEMP_DIR' DEVENV_ROOT_SET=1 DEVENV_TOOLS='$DEVENV_TOOLS'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        GH_ORG=env-org provider_org_get
    "
    [ "$status" -eq 0 ]
    [ "$output" = "cfg-org" ]
}

@test "provider_org_get: config [organization] org resolves" {
    provider_accessor_setup
    printf '[organization]\nname=t\norg=cfg-org\n' > "$TEST_TEMP_DIR/devenv.config"
    run bash -c "
        export DEVENV_ROOT='$TEST_TEMP_DIR' DEVENV_ROOT_SET=1 DEVENV_TOOLS='$DEVENV_TOOLS'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        provider_org_get
    "
    [ "$status" -eq 0 ]
    [ "$output" = "cfg-org" ]
}

@test "provider_org_get: seed file is the third leg" {
    provider_accessor_setup
    mkdir -p "$TEST_TEMP_DIR/.setup"
    printf 'seed-org\n' > "$TEST_TEMP_DIR/.setup/provider_org.txt"
    run bash -c "
        export DEVENV_ROOT='$TEST_TEMP_DIR' DEVENV_ROOT_SET=1 DEVENV_TOOLS='$DEVENV_TOOLS'
        unset GH_ORG
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        provider_org_get
    "
    [ "$status" -eq 0 ]
    [ "$output" = "seed-org" ]
}

@test "provider_org_get: fails with config-guided error when unresolvable" {
    provider_accessor_setup
    run bash -c "
        export DEVENV_ROOT='$TEST_TEMP_DIR' DEVENV_ROOT_SET=1 DEVENV_TOOLS='$DEVENV_TOOLS'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        provider_org_get
    "
    [ "$status" -ne 0 ]
    [[ "$output" == *"[organization] org"* ]]
}

@test "provider_org_get: raw read does not expand templates (no recursion)" {
    provider_accessor_setup
    # Config value that looks like a template: raw accessor must return it
    # verbatim, never interpolating (config-reader expansion calls back into
    # this accessor; expansion here would loop).
    printf '[organization]\nname=t\norg=${GH_ORG}\n' > "$TEST_TEMP_DIR/devenv.config"
    run bash -c "
        export DEVENV_ROOT='$TEST_TEMP_DIR' DEVENV_ROOT_SET=1 DEVENV_TOOLS='$DEVENV_TOOLS'
        unset GH_ORG
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        provider_org_get
    "
    [ "$status" -eq 0 ]
    [ "$output" = '${GH_ORG}' ]
}

@test "provider_user_get: GH_USER has no effect; config then seed" {
    provider_accessor_setup
    run bash -c "
        export DEVENV_ROOT='$TEST_TEMP_DIR' DEVENV_ROOT_SET=1 DEVENV_TOOLS='$DEVENV_TOOLS'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        GH_USER=env-user provider_user_get
    "
    [ "$status" -ne 0 ]

    printf '[organization]\nname=t\nuser=cfg-user\n' > "$TEST_TEMP_DIR/devenv.config"
    run bash -c "
        export DEVENV_ROOT='$TEST_TEMP_DIR' DEVENV_ROOT_SET=1 DEVENV_TOOLS='$DEVENV_TOOLS'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        provider_user_get
    "
    [ "$status" -eq 0 ]
    [ "$output" = "cfg-user" ]

    mkdir -p "$TEST_TEMP_DIR/.setup"
    printf 'seed-user\n' > "$TEST_TEMP_DIR/.setup/provider_user.txt"
    rm -f "$TEST_TEMP_DIR/devenv.config"
    run bash -c "
        export DEVENV_ROOT='$TEST_TEMP_DIR' DEVENV_ROOT_SET=1 DEVENV_TOOLS='$DEVENV_TOOLS'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        provider_user_get
    "
    [ "$status" -eq 0 ]
    [ "$output" = "seed-user" ]
}

@test "capability: declare validates against the canonical list" {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    run provider_declare_capability not-a-capability
    [ "$status" -ne 0 ]
    [[ "$output" == *"canonical"* ]]
}

@test "capability: canonical declares are idempotent and queryable" {
    # shellcheck disable=SC1091
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    provider_declare_capability pipelines
    provider_declare_capability pipelines
    provider_has_capability pipelines
    ! provider_has_capability releases
}

# ============================================================================
# A misconfigured provider name fails, loudly, at load time (F051)
# ============================================================================

load_provider_in_subshell() {   # load_provider_in_subshell <config-file>: runs provider_load, echoing status
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS' DEVENV_ROOT='$TEST_TEMP_DIR'
        source '$DEVENV_TOOLS/lib/error-handling.bash'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        provider_load issues
        echo \"load-status=\$? name=[\${PROVIDER_NAME:-}]\"
    "
}

@test "provider_load with an unshipped [provider] name fails and shows why" {
    printf '[provider]\nname=azrue\n' > "$TEST_TEMP_DIR/devenv.config"
    load_provider_in_subshell
    [[ "$output" == *"azrue"* ]]
    [[ "$output" == *"not shipped"* ]]
    [[ "$output" == *"azure"* && "$output" == *"github"* ]]
    [[ "$output" == *"load-status=1"* ]]
    [[ "$output" == *"name=[]"* ]]
}

@test "provider_load does not fall back to the typo it was given" {
    printf '[provider]\nname=azrue\n' > "$TEST_TEMP_DIR/devenv.config"
    load_provider_in_subshell
    [[ "$output" != *"does not implement"* ]]
    [[ "$output" != *"command not found"* ]]
}

@test "provider_load with a shipped name still succeeds" {
    printf '[provider]\nname=github\n' > "$TEST_TEMP_DIR/devenv.config"
    load_provider_in_subshell
    [[ "$output" == *"load-status=0"* ]]
    [[ "$output" == *"name=[github]"* ]]
}

@test "provider_load with no [provider] name uses the default provider" {
    printf '[workflows]\nstatus_workflow=A,B\n' > "$TEST_TEMP_DIR/devenv.config"
    load_provider_in_subshell
    [[ "$output" == *"load-status=0"* ]]
    [[ "$output" == *"name=[github]"* ]]
}

@test "the default provider is not read from the configured name (no circular binding)" {
    printf '[provider]\nname=azrue\n' > "$TEST_TEMP_DIR/devenv.config"
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS' DEVENV_ROOT='$TEST_TEMP_DIR'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        policy_default_provider
    "
    [ "$output" = "github" ]
}

@test "POLICY_DEFAULT_PROVIDER still overrides the default" {
    printf '[workflows]\nstatus_workflow=A,B\n' > "$TEST_TEMP_DIR/devenv.config"
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS' DEVENV_ROOT='$TEST_TEMP_DIR' POLICY_DEFAULT_PROVIDER=azure
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        policy_default_provider
    "
    [ "$output" = "azure" ]
}

# ============================================================================
# A verb the provider lacks is a defined error, not bash's 127 (F052)
# ============================================================================

@test "calling a provider verb that is not defined returns 1 and names the provider and verb" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        source '$DEVENV_TOOLS/lib/error-handling.bash'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=github
        provider_made_up_verb arg
        echo \"rc=\$?\"
    "
    [[ "$output" == *"rc=1"* ]]
    [[ "$output" == *"github"* ]]
    [[ "$output" == *"provider_made_up_verb"* ]]
    [[ "$output" == *"does not implement"* ]]
}

@test "a missing verb does not kill a set -e script before it can report" {
    run bash -c "
        set -e
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        source '$DEVENV_TOOLS/lib/error-handling.bash'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        if ! provider_made_up_verb; then echo 'handled'; fi
    "
    [ "$status" -eq 0 ]
    [[ "$output" == *"handled"* ]]
}

@test "an ordinary missing command is still bash's 127" {
    run bash -c "
        export DEVENV_TOOLS='$DEVENV_TOOLS'
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        not_a_provider_command_xyz
    "
    [ "$status" -eq 127 ]
    [[ "$output" == *"not_a_provider_command_xyz"* ]]
}
