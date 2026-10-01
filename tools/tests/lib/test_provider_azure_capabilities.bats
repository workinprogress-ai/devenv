#!/usr/bin/env bats
# Tests for the azure provider's capability declarations.
#
# The capability contract (provider-core) declares four canonical
# capabilities: rulesets, project-boards, native-issue-types, pipelines.
# Azure implements all four but historically declared none — these tests
# lock the dual-provider truth: every canonical capability reports true
# under a loaded azure provider.

bats_require_minimum_version 1.5.0

load ../test_helper
load ../fixtures/cli-stubs

setup() {
    test_helper_setup
    export STUB_CALL_LOG
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    export DEVENV_ROOT="$TEST_TEMP_DIR/devenv-root"
    mkdir -p "$DEVENV_ROOT"
    unset _PROVIDER_CORE_LOADED || true
    unset PROVIDER_NAME || true
    unset PROVIDER_CAPABILITIES || true
}

teardown() {
    unset DEVENV_ROOT
    test_helper_teardown
}

# Loads provider-core plus all azure modules that carry capability
# declarations, then asserts each canonical capability is reported.
@test "azure declares all four canonical capabilities" {
    run bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load issues projects pipelines org
        for cap in rulesets project-boards native-issue-types pipelines; do
            provider_has_capability \"\$cap\" || {
                echo \"MISSING: \$cap\" >&2
                exit 1
            }
        done
    "
    [ "$status" -eq 0 ]
}

@test "azure capability declarations match github's canonical set" {
    # Compare each provider's loaded capability set in its own subshell —
    # provider-core's loaded-guard makes a second in-shell source a no-op,
    # so cross-provider comparison must not share one shell.
    local azure_caps github_caps
    azure_caps=$(bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=azure
        provider_load issues projects pipelines org
        echo \"\$PROVIDER_CAPABILITIES\"
    ")
    github_caps=$(bash -c "
        source '$DEVENV_TOOLS/lib/providers/provider-core.bash'
        PROVIDER_NAME=github
        provider_load issues projects pipelines org
        echo \"\$PROVIDER_CAPABILITIES\"
    ")
    [ -n "$azure_caps" ] || { echo "azure set empty" >&2; return 1; }
    [ -n "$github_caps" ] || { echo "github set empty" >&2; return 1; }
    local cap
    for cap in $github_caps; do
        case " $azure_caps " in
            *" $cap "*) ;;
            *) echo "azure missing github capability: $cap" >&2; return 1 ;;
        esac
    done
}
