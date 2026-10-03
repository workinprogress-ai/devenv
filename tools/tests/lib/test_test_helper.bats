#!/usr/bin/env bats

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="$PROJECT_ROOT/tools"
    unset _PROVIDER_CORE_LOADED PROVIDER_NAME
}

teardown() {
    test_helper_teardown
}

@test "test helper: default provider detection is isolated from the real repo config" {
    source "$DEVENV_TOOLS/lib/providers/provider-core.bash"
    provider_detect

    [ "$DEVENV_ROOT" != "$PROJECT_ROOT" ]
    [ "$PROVIDER_NAME" = "github" ]
}
