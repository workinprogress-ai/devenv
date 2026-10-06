#!/usr/bin/env bats
# Guidance-currency lock: auth-failure instructions must name a command the
# environment actually defines. The credential-rotation entry point is
# `key-update-provider` (dispatched by bootstrap's generated shell
# functions); the historical `key-update-git` name was retired with the
# provider-neutral rename — any surviving occurrence sends users to a
# command that may not exist.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    export DEVENV_TOOLS="${BATS_TEST_DIRNAME}/../.."
    export DEVENV_ROOT="${BATS_TEST_DIRNAME}/../../.."
}

teardown() {
    test_helper_teardown
}

@test "no retired key-update-git name remains in shipped code" {
    local offenders
    offenders=$(grep -rn "key-update-git" \
        "$DEVENV_TOOLS/scripts" \
        "$DEVENV_TOOLS/lib/provider-loader.bash" \
        "$DEVENV_TOOLS/lib/providers/github/key-update.sh" \
        "$DEVENV_ROOT/.devcontainer/bootstrap.bash" \
        2>/dev/null || true)
    [ -z "$offenders" ] || {
        echo "retired key-update-git guidance found:" >&2
        echo "$offenders" >&2
        return 1
    }
}

@test "no retired key-update-git name remains in the docs or the skill/protocol references" {
    local offenders
    offenders=$(grep -rn "key-update-git" \
        "$DEVENV_ROOT/docs" \
        "$DEVENV_ROOT/copilot" \
        2>/dev/null || true)
    [ -z "$offenders" ] || {
        echo "retired key-update-git guidance found in docs:" >&2
        echo "$offenders" >&2
        return 1
    }
}

@test "the provider protocol documents provider_auth_import_token as stdin-fed, never argv" {
    # The token must stay out of process lists: the verb reads stdin by contract.
    local f="$DEVENV_ROOT/copilot/skills/_shared/references/provider-protocols/github.md"
    run grep -nE 'provider_auth_import_token[[:space:]]+TOKEN' "$f"
    [ "$status" -ne 0 ]
    grep -qE 'provider_auth_import_token[^`]*(<<<|<)' "$f"
}
