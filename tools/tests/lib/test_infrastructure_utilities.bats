#!/usr/bin/env bats

load ../test_helper

setup() {
  test_helper_setup
}

teardown() {
  test_helper_teardown
}

# Test port utilities
@test "is_port_in_use function exists" {
  source "${DEVENV_ROOT}/tools/lib/infrastructure-utilities.bash"
  declare -f is_port_in_use >/dev/null
}

@test "find_free_port function exists" {
  source "${DEVENV_ROOT}/tools/lib/infrastructure-utilities.bash"
  declare -f find_free_port >/dev/null
}

# Test IP utilities
@test "get_local_ip function exists" {
  source "${DEVENV_ROOT}/tools/lib/infrastructure-utilities.bash"
  declare -f get_local_ip >/dev/null
}

@test "get_public_ip function exists" {
  source "${DEVENV_ROOT}/tools/lib/infrastructure-utilities.bash"
  declare -f get_public_ip >/dev/null
}

# Test connectivity
@test "check_host_connectivity function exists" {
  source "${DEVENV_ROOT}/tools/lib/infrastructure-utilities.bash"
  declare -f check_host_connectivity >/dev/null
}

@test "is_port_open function exists" {
  source "${DEVENV_ROOT}/tools/lib/infrastructure-utilities.bash"
  declare -f is_port_open >/dev/null
}

@test "check_service_health function exists" {
  source "${DEVENV_ROOT}/tools/lib/infrastructure-utilities.bash"
  declare -f check_service_health >/dev/null
}

@test "wait_for_service function exists" {
  source "${DEVENV_ROOT}/tools/lib/infrastructure-utilities.bash"
  declare -f wait_for_service >/dev/null
}

# Regression (T002): error_msg was undefined in error-handling.bash, so any
# error path through these libs died with "command not found" (exit 127)
# instead of the function's own return code.
@test "is_port_in_use with empty port emits error_msg and returns 1, not 127" {
  source "${DEVENV_ROOT}/tools/lib/infrastructure-utilities.bash"

  run is_port_in_use ""
  [ "$status" -eq 1 ]
  [[ "$output" == *"Port number is required"* ]]
}

# Test library exports
@test "all infrastructure-utilities functions are exported" {
  source "${DEVENV_ROOT}/tools/lib/infrastructure-utilities.bash"
  
  declare -f is_port_in_use >/dev/null
  declare -f find_free_port >/dev/null
  declare -f get_local_ip >/dev/null
  declare -f check_host_connectivity >/dev/null
}

@test "infrastructure-utilities library loads without errors" {
  source "${DEVENV_ROOT}/tools/lib/infrastructure-utilities.bash"
  [[ -n "$_INFRASTRUCTURE_UTILITIES_LOADED" ]]
}

# ============================================================================
# Network probes must not hang on a blackholed route
# ============================================================================

# A socket that accepts connections and never answers: what a blackholed or
# half-dead route looks like to curl. Sets BLACKHOLE_PORT and BLACKHOLE_PID.
start_blackhole() {
  local port_file="$TEST_TEMP_DIR/blackhole.port"
  python3 -c '
import socket, sys, time
s = socket.socket()
s.bind(("127.0.0.1", 0))
s.listen(5)
open(sys.argv[1], "w").write(str(s.getsockname()[1]))
conns = []
while True:
    c, _ = s.accept()
    conns.append(c)   # hold it open, never reply
' "$port_file" &
  BLACKHOLE_PID=$!
  local waited
  for waited in $(seq 1 50); do
    [ -s "$port_file" ] && break
    sleep 0.1
  done
  BLACKHOLE_PORT="$(cat "$port_file")"
}

stop_blackhole() {
  kill "$BLACKHOLE_PID" 2>/dev/null || true
  wait "$BLACKHOLE_PID" 2>/dev/null || true
}

@test "check_service_health gives up on a service that accepts but never answers" {
  start_blackhole
  # test_helper puts a guard curl first on PATH; these tests need the real one.
  run timeout 15 bash -c "
    export PATH=/usr/bin:/bin
    source '$PROJECT_ROOT/tools/lib/infrastructure-utilities.bash'
    INFRA_CURL_MAX_TIME=1 check_service_health 'http://127.0.0.1:$BLACKHOLE_PORT/health'
  "
  stop_blackhole
  # 1 = the check failed promptly; 124 would mean it hung until the outer timeout.
  [ "$status" -eq 1 ]
}

@test "wait_for_service finishes in bounded time against a blackholed service" {
  start_blackhole
  local start=$SECONDS
  run timeout 20 bash -c "
    export PATH=/usr/bin:/bin
    source '$PROJECT_ROOT/tools/lib/infrastructure-utilities.bash'
    INFRA_CURL_MAX_TIME=1 wait_for_service 'http://127.0.0.1:$BLACKHOLE_PORT/health' 2 0
  "
  stop_blackhole
  [ "$status" -eq 1 ]
  [[ "$output" == *"did not become available"* ]]
  [ $((SECONDS - start)) -lt 10 ]
}

@test "every curl in get_public_ip and check_service_health carries connect and total timeouts" {
  mkdir -p "$TEST_TEMP_DIR/bin"
  export CURL_ARGS_LOG="$TEST_TEMP_DIR/curl-args.log"
  : > "$CURL_ARGS_LOG"
  # First two services "fail", the third answers: exercises all three fallbacks.
  printf '%s\n' '#!/usr/bin/env bash' \
    'echo "CALL $*" >> "$CURL_ARGS_LOG"' \
    'case "$*" in *icanhazip*) echo 203.0.113.9; exit 0 ;; *"%{http_code}"*) printf "200"; exit 0 ;; *) exit 1 ;; esac' \
    > "$TEST_TEMP_DIR/bin/curl"
  chmod +x "$TEST_TEMP_DIR/bin/curl"
  run env PATH="$TEST_TEMP_DIR/bin:$PATH" bash -c "
    source '$PROJECT_ROOT/tools/lib/infrastructure-utilities.bash'
    get_public_ip
    check_service_health http://svc.invalid/health
  "
  [ "$status" -eq 0 ]
  [ "$(grep -c '^CALL' "$CURL_ARGS_LOG")" -eq 4 ]
  [ "$(grep '^CALL' "$CURL_ARGS_LOG" | grep -c -- '--connect-timeout')" -eq 4 ]
  [ "$(grep '^CALL' "$CURL_ARGS_LOG" | grep -c -- '--max-time')" -eq 4 ]
}
