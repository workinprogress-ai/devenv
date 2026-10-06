#!/usr/bin/env bats
# container-enable-dotnet-debugger.sh: the argument guard, and that a given
# container name reaches docker. docker is a recording stand-in.

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
    test_helper_setup
    SCRIPT="$PROJECT_ROOT/tools/scripts/container-enable-dotnet-debugger.sh"
    mkdir -p "$TEST_TEMP_DIR/bin"
    export DOCKER_LOG="$TEST_TEMP_DIR/docker.log"
    : > "$DOCKER_LOG"
    printf '%s\n' '#!/usr/bin/env bash' 'echo "docker $*" >> "$DOCKER_LOG"' > "$TEST_TEMP_DIR/bin/docker"
    chmod +x "$TEST_TEMP_DIR/bin/docker"
    export PATH="$TEST_TEMP_DIR/bin:$PATH"
}

@test "a bare invocation prints the message and exits 1 instead of an unbound-variable error" {
    run bash "$SCRIPT"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Provide the container name"* ]]
    [[ "$output" != *"unbound variable"* ]]
    [ ! -s "$DOCKER_LOG" ]
}

@test "an empty container name is refused the same way" {
    run bash "$SCRIPT" ""
    [ "$status" -eq 1 ]
    [[ "$output" == *"Provide the container name"* ]]
    [ ! -s "$DOCKER_LOG" ]
}

@test "a container name is passed through to every docker exec" {
    run bash "$SCRIPT" mycontainer
    [ "$status" -eq 0 ]
    [ "$(grep -c '^docker exec mycontainer ' "$DOCKER_LOG")" -eq 4 ]
    grep -q 'docker exec mycontainer mkdir -p /remote_debugger' "$DOCKER_LOG"
    grep -q 'docker exec mycontainer /bin/bash /remote_debugger/getvsdbg.sh -v latest -l /remote_debugger' "$DOCKER_LOG"
}
