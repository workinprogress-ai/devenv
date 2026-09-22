#!/usr/bin/env bats
# Behavior tests for the key-update family.
#
# Locks: non-interactive invocation without an argument refuses (non-zero,
# no hang on the read prompt); the git-protocol script rotates via gh's credential
# store (gh auth login) and writes no token files; the DO script persists
# token files with 600 permissions and calls the updater with the value.
#
# The scripts invoke the env-var updater by absolute path
# ($DEVENV_TOOLS/devenv-add-env-vars[.sh]), so PATH stubbing cannot intercept
# it — tests point DEVENV_TOOLS at a fake tools root that symlinks the real
# lib/ and provides recording stubs for the updater. tailscale needs PATH
# stubs for sudo and the tailscale CLI; github needs a PATH stub for gh.

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
    cat > "$BIN/gh" << 'EOF'
#!/usr/bin/env bash
echo "gh $*" >> "${CALL_LOG:?}"
if [[ "${STUB_GH_LOGIN_FAIL:-0}" == "1" && "$1 $2" == "auth login" ]]; then
    echo "gh: login failed" >&2
    exit 1
fi
exit 0
EOF
    chmod +x "$BIN/sudo" "$BIN/tailscale" "$BIN/gh"
    export PATH="$BIN:$PATH"

    # Copies of the scripts under test live inside the fake tools root so the
    # scripts self-locate there (self-root contract: an exported foreign
    # DEVENV_TOOLS no longer redirects them). The fake root's lib/ symlink
    # resolves their lib sources; the updater stubs above record calls.
    mkdir -p "$FAKE_TOOLS/scripts"
    cp "$PROJECT_ROOT/tools/scripts/key-update-do.sh" "$FAKE_TOOLS/scripts/"
    # Plan-issue-38-001 P2 (test-first): the git-family script does not exist
    # under its new name until the P3 rename lands. Copy it only when present
    # so its absence fails only the key-update-git tests, not the whole suite.
    if [ -f "$PROJECT_ROOT/tools/scripts/key-update-git.sh" ]; then
        cp "$PROJECT_ROOT/tools/scripts/key-update-git.sh" "$FAKE_TOOLS/scripts/"
    fi
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

@test "key-update-git: no argument with closed stdin refuses without hanging" {
    run bash "$PROJECT_ROOT/tools/scripts/key-update-git.sh" < /dev/null
    [ "$status" -ne 0 ]
    [[ "$output" == *"No token provided"* ]]
    [ ! -s "$CALL_LOG" ]
}

@test "key-update-git: argument path rotates via gh keychain and writes no token files" {
    run bash "$FAKE_TOOLS/scripts/key-update-git.sh" "ghp_abcdef1234567890"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Success"* ]]
    grep -q "gh auth login --with-token --hostname github.com" "$CALL_LOG"
    grep -q "gh auth setup-git --hostname github.com" "$CALL_LOG"
    [ ! -f "$DEVENV_ROOT/.setup/github_token.txt" ]
    ! grep -q "devenv-add-env-vars" "$CALL_LOG"
}

@test "key-update-git: does not export GH_TOKEN (allowlist-only contract)" {
    run bash "$FAKE_TOOLS/scripts/key-update-git.sh" "ghp_abcdef1234567890"
    [ "$status" -eq 0 ]
    # The script runs in a child shell, so an export could not reach this
    # process; assert the contract at the source instead: no export line.
    ! grep -q 'export GH_TOKEN=' "$FAKE_TOOLS/scripts/key-update-git.sh"
}

@test "key-update-git: gh login failure aborts with no side effects" {
    STUB_GH_LOGIN_FAIL=1 run bash "$FAKE_TOOLS/scripts/key-update-git.sh" "ghp_bad"
    [ "$status" -ne 0 ]
    [[ "$output" == *"No changes made"* ]]
    ! grep -q "gh auth setup-git" "$CALL_LOG"
    [ ! -f "$DEVENV_ROOT/.setup/github_token.txt" ]
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

# Active since the Plan-issue-38-001 test-first migration (P2).
@test "key-update-git.sh exists" {
  run bash -n "$PROJECT_ROOT/tools/scripts/key-update-git.sh"
  [ "$status" -eq 0 ]
}
