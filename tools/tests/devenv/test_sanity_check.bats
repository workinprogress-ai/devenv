#!/usr/bin/env bats
# sanity-check.sh is sourced by the generated shell rc at every shell start (and
# executed by startup.sh). It must be plain bash: its bootstrap run-time warning
# must appear only when the container's and the repo's run times really differ.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    ROOT="$TEST_TEMP_DIR/root"
    HOME_DIR="$TEST_TEMP_DIR/home"
    mkdir -p "$ROOT/.devcontainer" "$ROOT/.runtime" "$ROOT/tools" "$HOME_DIR"
    cp "$PROJECT_ROOT/.devcontainer/sanity-check.sh" "$ROOT/.devcontainer/"
    # The update check is not under test here.
    printf '#!/bin/bash\nexit 0\n' > "$ROOT/.devcontainer/check-update-devenv-repo.sh"
    # The wrapper smoke check wants a working next-id; give it one.
    printf '#!/bin/bash\nexit 0\n' > "$ROOT/tools/next-id"
    chmod +x "$ROOT/.devcontainer/check-update-devenv-repo.sh" "$ROOT/tools/next-id"
}

# Source the script the way the rc does, in a clean environment.
source_sanity() {
    env -i HOME="$HOME_DIR" PATH=/usr/bin:/bin DEVENV_ROOT="$ROOT" \
        bash -c "source '$ROOT/.devcontainer/sanity-check.sh'; echo \"rc=\$?\""
}

@test "matching bootstrap run times: no warning" {
    echo 1700000000 > "$HOME_DIR/.bootstrap_container_time"
    echo 1700000000 > "$ROOT/.runtime/.bootstrap_run_time"
    run source_sanity
    [[ "$output" != *"WARNING"* ]]
    [[ "$output" == *"rc=0"* ]]
}

@test "neither run-time file present (fresh container): no warning" {
    run source_sanity
    [[ "$output" != *"WARNING"* ]]
}

@test "differing bootstrap run times: warns to rebuild" {
    echo 1700000000 > "$HOME_DIR/.bootstrap_container_time"
    echo 1700009999 > "$ROOT/.runtime/.bootstrap_run_time"
    run source_sanity
    [[ "$output" == *"bootstrap run time does not match"* ]]
    [[ "$output" == *"rebuild"* ]]
}

@test "sourcing it leaves no helper function or variable behind in the shell" {
    run env -i HOME="$HOME_DIR" PATH=/usr/bin:/bin DEVENV_ROOT="$ROOT" bash -c "
        before=\$(compgen -A function; compgen -v)
        source '$ROOT/.devcontainer/sanity-check.sh' >/dev/null 2>&1
        after=\$(compgen -A function; compgen -v)
        diff <(echo \"\$before\" | sort) <(echo \"\$after\" | sort) | grep '^>' | grep -v -E 'BASH_|_=|before|after|OLDPWD|PIPESTATUS' || true"
    [ -z "$output" ] || { echo "leaked: $output"; return 1; }
}

@test "the script has no backslash-escaped dollars (the eval-expansion pretense)" {
    # Plain source treats \$ as a literal dollar sign, which is what made the
    # run-time comparison compare two different literal strings.
    run grep -nF '\$' "$PROJECT_ROOT/.devcontainer/sanity-check.sh"
    [ "$status" -eq 1 ] || { echo "$output"; return 1; }
}
