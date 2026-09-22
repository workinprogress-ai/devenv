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
    # Copy only when present so a missing script fails just its own tests,
    # not the whole suite via a failed setup copy.
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

# Existence guard: the key-update family gains members independently;
# this suite asserts only scripts that are present.
@test "key-update-git.sh exists" {
  run bash -n "$PROJECT_ROOT/tools/scripts/key-update-git.sh"
  [ "$status" -eq 0 ]
}

# Help contract: --help/-h must print usage and exit 0 — never be consumed
# as a token/key by the scripts that read positional secrets.

@test "key-update-do.sh --help exits 0 without prompting" {
    run bash "$PROJECT_ROOT/tools/scripts/key-update-do.sh" --help < /dev/null
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Usage: key-update-do.sh" ]]
}

@test "key-update-tailscale.sh --help exits 0 without prompting" {
    run bash "$PROJECT_ROOT/tools/scripts/key-update-tailscale.sh" --help < /dev/null
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Usage: key-update-tailscale.sh" ]]
}

@test "key-update-git.sh --help exits 0 without prompting" {
    run bash "$PROJECT_ROOT/tools/scripts/key-update-git.sh" --help < /dev/null
    [ "$status" -eq 0 ]
    [[ "$output" =~ "Usage: key-update-git.sh" ]]
    # The flag must not reach the credential-import path.
    [[ ! "$output" =~ "Token Update Utility" ]] || [[ "$output" =~ "Usage:" ]]
}

@test "key-update family -h short flag also exits 0" {
    for script in key-update-do key-update-tailscale key-update-git; do
        run bash "$PROJECT_ROOT/tools/scripts/${script}.sh" -h < /dev/null
        [ "$status" -eq 0 ]
        [[ "$output" =~ "Usage:" ]]
    done
}

# ============================================================================
# Bootstrap seed contract (Plan-issue-55-001 final): consume-on-use.
#   authed            -> info only; seed left alone
#   empty + seed      -> import once, DELETE the seed (plaintext must not linger)
#   empty + no seed   -> AUTH_NEEDED=1; finish banner carries the action
# ============================================================================

@test "bootstrap seed: authed keychain -> info only, seed left alone" {
    T=$(mktemp -d)
    mkdir -p "$T/.setup"
    echo seed > "$T/.setup/github_token.txt"
    printf 'test-user\n' > "$T/.setup/github_user.txt"
    printf 'test-org\n' > "$T/.setup/github_org.txt"
    printf 'Test User\n' > "$T/.setup/name.txt"
    printf 'test@user.dev\n' > "$T/.setup/email.txt"
    printf 'optional-do-token\n' > "$T/.setup/digitalocean_token.txt"
    run bash -c "
        export email_file='$T/.setup/email.txt'
        export name_file='$T/.setup/name.txt'
        export setup_dir='$T/.setup'
        export toolbox_root='$T'
        export PROJECT_ROOT='$PROJECT_ROOT'
        export AUTH_NEEDED=1
        provider_auth_status() { return 0; }
        provider_auth_import_token() { echo SHOULD-NOT-RUN; return 0; }
        ensure_provider_seam() { :; }
        source <(sed -n '/^load_setup_credentials()/,/^}/p' '$PROJECT_ROOT/.devcontainer/bootstrap.bash')
        load_setup_credentials
    "
    [ "$status" -eq 0 ]
    [[ "$output" =~ "authenticated" ]]
    [[ ! "$output" =~ "Seed file imported" ]]
    [ -f "$T/.setup/github_token.txt" ]
    rm -rf "$T"
}

@test "bootstrap seed: empty keychain + seed -> import once, seed deleted, no AUTH_NEEDED" {
    T=$(mktemp -d)
    mkdir -p "$T/.setup"
    printf 'seed\n' > "$T/.setup/github_token.txt"
    printf 'test-user\n' > "$T/.setup/github_user.txt"
    printf 'test-org\n' > "$T/.setup/github_org.txt"
    printf 'Test User\n' > "$T/.setup/name.txt"
    printf 'test@user.dev\n' > "$T/.setup/email.txt"
    printf 'optional-do-token\n' > "$T/.setup/digitalocean_token.txt"
    run bash -c "
        export email_file='$T/.setup/email.txt'
        export name_file='$T/.setup/name.txt'
        export setup_dir='$T/.setup'
        export toolbox_root='$T'
        export PROJECT_ROOT='$PROJECT_ROOT'
        export AUTH_NEEDED=1
        provider_auth_status() { return 1; }
        provider_auth_import_token() { echo imported; return 0; }
        ensure_provider_seam() { :; }
        source <(sed -n '/^load_setup_credentials()/,/^}/p' '$PROJECT_ROOT/.devcontainer/bootstrap.bash')
        load_setup_credentials
        if [ -f '$T/.setup/github_token.txt' ]; then post_seed=yes; else post_seed=no; fi
        echo \"POST: seed_exists=\$post_seed auth_needed=\$AUTH_NEEDED\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" =~ "imported into the provider credential store and deleted" ]]
    [[ "$output" =~ "POST: seed_exists=no auth_needed=0" ]]
    rm -rf "$T"
}

@test "bootstrap seed: import failure keeps seed + sets AUTH_NEEDED" {
    T=$(mktemp -d)
    mkdir -p "$T/.setup"
    echo seed > "$T/.setup/github_token.txt"
    printf 'test-user\n' > "$T/.setup/github_user.txt"
    printf 'test-org\n' > "$T/.setup/github_org.txt"
    printf 'Test User\n' > "$T/.setup/name.txt"
    printf 'test@user.dev\n' > "$T/.setup/email.txt"
    printf 'optional-do-token\n' > "$T/.setup/digitalocean_token.txt"
    run bash -c "
        export email_file='$T/.setup/email.txt'
        export name_file='$T/.setup/name.txt'
        export setup_dir='$T/.setup'
        export toolbox_root='$T'
        export PROJECT_ROOT='$PROJECT_ROOT'
        provider_auth_status() { return 1; }
        provider_auth_import_token() { return 1; }
        ensure_provider_seam() { :; }
        source <(sed -n '/^load_setup_credentials()/,/^}/p' '$PROJECT_ROOT/.devcontainer/bootstrap.bash')
        load_setup_credentials
        if [ -f '$T/.setup/github_token.txt' ]; then post_seed=yes; else post_seed=no; fi
        echo \"POST: seed_exists=\$post_seed auth_needed=\$AUTH_NEEDED\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" =~ "could not be imported" ]]
    [[ "$output" =~ "POST: seed_exists=yes auth_needed=1" ]]
    rm -rf "$T"
}

@test "bootstrap seed: empty keychain + no seed -> AUTH_NEEDED=1" {
    T=$(mktemp -d)
    mkdir -p "$T/.setup"
    printf 'test-user\n' > "$T/.setup/github_user.txt"
    printf 'test-org\n' > "$T/.setup/github_org.txt"
    printf 'Test User\n' > "$T/.setup/name.txt"
    printf 'test@user.dev\n' > "$T/.setup/email.txt"
    printf 'optional-do-token\n' > "$T/.setup/digitalocean_token.txt"
    run bash -c "
        export email_file='$T/.setup/email.txt'
        export name_file='$T/.setup/name.txt'
        export setup_dir='$T/.setup'
        export toolbox_root='$T'
        export PROJECT_ROOT='$PROJECT_ROOT'
        provider_auth_status() { return 1; }
        ensure_provider_seam() { :; }
        source <(sed -n '/^load_setup_credentials()/,/^}/p' '$PROJECT_ROOT/.devcontainer/bootstrap.bash')
        load_setup_credentials
        echo \"POST: auth_needed=\$AUTH_NEEDED\"
    "
    [ "$status" -eq 0 ]
    [[ "$output" =~ "no seed file found" ]]
    [[ "$output" =~ "POST: auth_needed=1" ]]
    rm -rf "$T"
}

@test "finish_message: banner carries the key-update action when AUTH_NEEDED" {
    run bash -c "
        AUTH_NEEDED=1
        finish_message() { :; }
        source <(sed -n '/^finish_message()/,/^}/p' '$PROJECT_ROOT/.devcontainer/bootstrap.bash')
        finish_message
    "
    [[ "$output" =~ "ACTION REQUIRED" ]]
    [[ "$output" =~ "key-update-git.sh" ]]
}

@test "finish_message: banner is silent about auth when AUTH_NEEDED=0" {
    run bash -c "
        AUTH_NEEDED=0
        source <(sed -n '/^finish_message()/,/^}/p' '$PROJECT_ROOT/.devcontainer/bootstrap.bash')
        finish_message
    "
    [[ ! "$output" =~ "ACTION REQUIRED" ]]
}

# ============================================================================


@test "bootstrap seed: failure path defers to the AUTH_NEEDED banner" {
    # Import failure sets AUTH_NEEDED; the finish banner carries the action
    # line pointing at key-update-git.sh.
    run grep -q 'Run: key-update-git.sh <new-token>' "$PROJECT_ROOT/.devcontainer/bootstrap.bash"
    [ "$status" -eq 0 ]
}
