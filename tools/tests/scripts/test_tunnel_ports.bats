#!/usr/bin/env bats
# tunnel-ports.sh smoke tests. ssh is a stand-in that records its arguments,
# notes its PID and sleeps, so tunnels can be "opened" and closed for real.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    SCRIPT="$PROJECT_ROOT/tools/scripts/tunnel-ports.sh"
    mkdir -p "$TEST_TEMP_DIR/bin"
    export SSH_LOG="$TEST_TEMP_DIR/ssh-args.log"
    export SSH_PID_LOG="$TEST_TEMP_DIR/ssh-pids.log"
    : > "$SSH_LOG"
    : > "$SSH_PID_LOG"
    cat > "$TEST_TEMP_DIR/bin/ssh" <<'STUB'
#!/usr/bin/env bash
{ printf 'ARG:%s\n' "$@"; echo "END-OF-CALL"; } >> "$SSH_LOG"
echo "$$" >> "$SSH_PID_LOG"
exec sleep 30
STUB
    chmod +x "$TEST_TEMP_DIR/bin/ssh"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
}

# Run the script, answering its "press any key" prompt only once the expected
# number of ssh stand-ins has started and logged (otherwise the script closes
# the tunnels before they have recorded anything).
run_tunnels() {
    local expect="${EXPECT_CALLS:-1}" waited
    {
        for waited in $(seq 1 100); do
            [ "$(wc -l < "$SSH_PID_LOG")" -ge "$expect" ] && break
            sleep 0.1
        done
        printf 'x'
    } | bash "$SCRIPT" "$@"
}

@test "no arguments prints the usage line instead of an unbound-variable error" {
    run bash "$SCRIPT"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Usage:"* ]]
    [[ "$output" != *"unbound variable"* ]]
}

@test "a tunnel without -i opens and closes cleanly" {
    # SSH_CERT used to be read while unset, aborting the run at the first
    # tunnel: invocations without -i never worked.
    run run_tunnels user@host 8080:db.internal
    [ "$status" -eq 0 ]
    [[ "$output" == *"Opening tunnel: Local port 8080 to db.internal through user@host"* ]]
    [[ "$output" == *"Tunnels closed."* ]]
    grep -qx "ARG:-L" "$SSH_LOG"
    grep -qx "ARG:8080:db.internal:8080" "$SSH_LOG"
    grep -qx "ARG:22" "$SSH_LOG"
    grep -qx "ARG:user@host" "$SSH_LOG"
    run ! grep -qx "ARG:-i" "$SSH_LOG"
}

@test "-p sets the ssh port" {
    run run_tunnels -p 2222 user@host 8080:db.internal
    [ "$status" -eq 0 ]
    grep -qx "ARG:2222" "$SSH_LOG"
}

@test "-i passes a key path containing spaces as one argument" {
    run run_tunnels -i "/tmp/my key/id_rsa" user@host 8080:db.internal
    [ "$status" -eq 0 ]
    grep -qx "ARG:-i" "$SSH_LOG"
    grep -qx "ARG:/tmp/my key/id_rsa" "$SSH_LOG"
}

@test "every opened tunnel is closed when the run ends" {
    EXPECT_CALLS=2 run run_tunnels user@host 8080:db.one 9090:db.two
    [ "$status" -eq 0 ]
    [ "$(grep -c END-OF-CALL "$SSH_LOG")" -eq 2 ]
    local pid
    while read -r pid; do
        run ! kill -0 "$pid"
    done < "$SSH_PID_LOG"
}

@test "options without a target print usage instead of an unbound-variable error" {
    run bash "$SCRIPT" -p 2222
    [ "$status" -eq 1 ]
    [[ "$output" == *"Usage:"* ]]
    [[ "$output" != *"unbound variable"* ]]
}
