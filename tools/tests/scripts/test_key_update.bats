#!/usr/bin/env bats
# Behavior tests for the key-update family.
#
# Locks: non-interactive invocation without an argument refuses (non-zero,
# no hang on the read prompt); persisted token files carry 600 permissions;
# the backing provider (devenv-add-env-vars / tailscale daemon) is invoked
# with the supplied value.
#
# The scripts invoke the env-var updater by absolute path
# ($DEVENV_TOOLS/devenv-add-env-vars[.sh]), so PATH stubbing cannot intercept
# it — tests point DEVENV_TOOLS at a fake tools root that symlinks the real
# lib/ and provides recording stubs for the updater. tailscale additionally
# needs PATH stubs for sudo and the tailscale CLI.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup

    # Fake tools root: real lib/ for error-handling, stub updater at root.
    FAKE_TOOLS="$TEST_TEMP_DIR/checkout/tools"
    mkdir -p "$FAKE_TOOLS"
    ln -s "$PROJECT_ROOT/tools/lib" "$FAKE_TOOLS/lib"
    export DEVENV_TOOLS="$FAKE_TOOLS"

    # Isolated DEVENV_ROOT so .setup/.runtime writes stay in the sandbox.
    export DEVENV_ROOT="$TEST_TEMP_DIR/devroot"
    mkdir -p "$DEVENV_ROOT/.setup" "$DEVENV_ROOT/.runtime"

    CALL_LOG="$TEST_TEMP_DIR/calls.log"
    export CALL_LOG
    : > "$CALL_LOG"

    cat > "$FAKE_TOOLS/devenv-add-env-vars.sh" << 'EOF'
#!/usr/bin/env bash
echo "devenv-add-env-vars.sh $*" >> "${CALL_LOG:?}"
exit 0
EOF
    cat > "$FAKE_TOOLS/devenv-add-env-vars" << 'EOF'
#!/usr/bin/env bash
echo "devenv-add-env-vars $*" >> "${CALL_LOG:?}"
exit 0
EOF
    chmod +x "$FAKE_TOOLS/devenv-add-env-vars.sh" "$FAKE_TOOLS/devenv-add-env-vars"

    # PATH stubs for the tailscale path.
    BIN="$TEST_TEMP_DIR/bin"
    mkdir -p "$BIN"
    cat > "$BIN/sudo" << 'EOF'
#!/usr/bin/env bash
echo "sudo $*" >> "${CALL_LOG:?}"
exec "$@"
EOF
    cat > "$BIN/tailscale" << 'EOF'
#!/usr/bin/env bash
echo "tailscale $*" >> "${CALL_LOG:?}"
case "$1 $2" in
    "status --json") echo '{"HostName": "testhost"}' ;;
    up) exit 0 ;;
    status) echo "testhost   user@   -" ;;
    *) exit 0 ;;
esac
EOF
    chmod +x "$BIN/sudo" "$BIN/tailscale"
    export PATH="$BIN:$PATH"

    # Copies of the scripts under test live inside the fake tools root so the
    # scripts self-locate there (self-root contract: an exported foreign
    # DEVENV_TOOLS no longer redirects them). The fake root's lib/ symlink
    # resolves their lib sources; the updater stubs above record calls.
    mkdir -p "$FAKE_TOOLS/scripts"
    cp "$PROJECT_ROOT/tools/scripts/key-update-do.sh" "$FAKE_TOOLS/scripts/"
    cp "$PROJECT_ROOT/tools/scripts/key-update-github.sh" "$FAKE_TOOLS/scripts/"
    cp "$PROJECT_ROOT/tools/scripts/key-update-tailscale.sh" "$FAKE_TOOLS/scripts/"
}

@test "key-update-do: no argument with closed stdin refuses without hanging" {
    run bash "$PROJECT_ROOT/tools/scripts/key-update-do.sh" < /dev/null
    [ "$status" -ne 0 ]
    [[ "$output" == *"No token provided"* ]]
    [ ! -s "$CALL_LOG" ]
    [ ! -f "$DEVENV_ROOT/.setup/do_token.txt" ]
}

@test "key-update-do: argument path stores token with 600 and calls the updater" {
    run bash "$FAKE_TOOLS/scripts/key-update-do.sh" "d0token1234567890abcdef1234567890"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Success"* ]]
    [ "$(stat -c '%a' "$DEVENV_ROOT/.setup/do_token.txt")" = "600" ]
    grep -q "^d0token1234567890abcdef1234567890$" "$DEVENV_ROOT/.setup/do_token.txt"
    grep -q "devenv-add-env-vars.sh DO_TOKEN=d0token1234567890abcdef1234567890" "$CALL_LOG"
}

@test "key-update-github: no argument with closed stdin refuses without hanging" {
    run bash "$PROJECT_ROOT/tools/scripts/key-update-github.sh" < /dev/null
    [ "$status" -ne 0 ]
    [[ "$output" == *"No token provided"* ]]
    [ ! -s "$CALL_LOG" ]
}

@test "key-update-github: argument path stores token with 600 and calls the updater" {
    run bash "$FAKE_TOOLS/scripts/key-update-github.sh" "ghp_abcdef1234567890"
    [ "$status" -eq 0 ]
    [ "$(stat -c '%a' "$DEVENV_ROOT/.setup/github_token.txt")" = "600" ]
    grep -q "^ghp_abcdef1234567890$" "$DEVENV_ROOT/.setup/github_token.txt"
    grep -q "devenv-add-env-vars GH_TOKEN=ghp_abcdef1234567890" "$CALL_LOG"
}

@test "key-update-tailscale: closed stdin refuses without hanging" {
    run bash "$PROJECT_ROOT/tools/scripts/key-update-tailscale.sh" < /dev/null
    [ "$status" -ne 0 ]
    [[ "$output" == *"No key provided"* ]]
    ! grep -q "tailscale up" "$CALL_LOG"
}

@test "key-update-tailscale: non-tskey input refuses before any daemon call" {
    KEYFILE="$TEST_TEMP_DIR/key.txt"
    printf 'not-a-tskey\n' > "$KEYFILE"
    run bash "$PROJECT_ROOT/tools/scripts/key-update-tailscale.sh" < "$KEYFILE"
    [ "$status" -ne 0 ]
    [[ "$output" == *"Invalid key format"* ]]
    ! grep -q "sudo tailscale up" "$CALL_LOG"
}

@test "key-update-tailscale: valid key re-auths the daemon and persists the value" {
    KEYFILE="$TEST_TEMP_DIR/key.txt"
    printf 'tskey-abc123def456\n' > "$KEYFILE"
    run bash "$FAKE_TOOLS/scripts/key-update-tailscale.sh" < "$KEYFILE"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Success"* ]]
    grep -q "sudo tailscale up --authkey=tskey-abc123def456" "$CALL_LOG"
    grep -q "devenv-add-env-vars.sh TS_AUTHKEY=tskey-abc123def456" "$CALL_LOG"
}
