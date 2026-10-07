#!/usr/bin/env bats
# Tests for container-start.sh locking mechanism and bootstrap coordination

bats_require_minimum_version 1.5.0

load ../test_helper

setup() {
  test_helper_setup
  
  # Create mock environment
  export HOME="$TEST_TEMP_DIR/home"
  mkdir -p "$HOME"
  
  # Create mock toolbox structure
  export MOCK_TOOLBOX="$TEST_TEMP_DIR/toolbox"
  mkdir -p "$MOCK_TOOLBOX/.devcontainer"
  
  # Create mock bootstrap script
  cat > "$MOCK_TOOLBOX/.devcontainer/bootstrap.sh" << 'EOF'
#!/bin/bash
echo "Bootstrap running"
sleep 1
date +%s > "$HOME/.bootstrap_container_time"
date +%s > "$(dirname "$0")/.bootstrap_run_time"
echo "Bootstrap completed"
EOF
  chmod +x "$MOCK_TOOLBOX/.devcontainer/bootstrap.sh"
  
  # Create mock startup script
  cat > "$MOCK_TOOLBOX/.devcontainer/startup.sh" << 'EOF'
#!/bin/bash
echo "Startup running"
EOF
  chmod +x "$MOCK_TOOLBOX/.devcontainer/startup.sh"
}

teardown() {
  cd "$ORIGINAL_PWD" 2>/dev/null || true
  test_helper_teardown
}

@test "container-start.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/.devcontainer/container-start.sh"
  [ "$status" -eq 0 ]
}

@test "container-start.sh defines get_run_time function" {
  run grep "^function get_run_time()" "$PROJECT_ROOT/.devcontainer/container-start.sh"
  [ "$status" -eq 0 ]
}

@test "container-start.sh defines run_bootstrap function with locking" {
  run grep "run_bootstrap()" "$PROJECT_ROOT/.devcontainer/container-start.sh"
  [ "$status" -eq 0 ]
  run grep "flock" "$PROJECT_ROOT/.devcontainer/container-start.sh"
  [ "$status" -eq 0 ]
}

@test "container-start.sh uses bootstrap lock file" {
  run grep "bootstrap_lock_file=" "$PROJECT_ROOT/.devcontainer/container-start.sh"
  [ "$status" -eq 0 ]
}

@test "container-start.sh checks bootstrap run times" {
  run grep "container_bootstrap_run_file=" "$PROJECT_ROOT/.devcontainer/container-start.sh"
  [ "$status" -eq 0 ]
  run grep "repo_bootstrap_run_file=" "$PROJECT_ROOT/.devcontainer/container-start.sh"
  [ "$status" -eq 0 ]
}

@test "container-start.sh has timeout for lock acquisition" {
  run grep "max_wait=" "$PROJECT_ROOT/.devcontainer/container-start.sh"
  [ "$status" -eq 0 ]
}

@test "container-start.sh runs startup.sh when bootstrap is current" {
  run grep "startup.sh" "$PROJECT_ROOT/.devcontainer/container-start.sh"
  [ "$status" -eq 0 ]
}

@test "container-start.sh runs custom-startup.sh if present" {
  run grep "custom-startup.sh" "$PROJECT_ROOT/.devcontainer/startup.sh"
  [ "$status" -eq 0 ]
}

@test "container-start.sh warns when no repos are cloned" {
  run grep "No repos have been cloned yet" "$PROJECT_ROOT/.devcontainer/container-start.sh"
  [ "$status" -eq 0 ]
}

@test "get_run_time returns 0 for missing file" {
  cat > "$TEST_TEMP_DIR/test_get_run_time.sh" << 'EOF'
#!/bin/bash
function get_run_time() {
  if [ ! -f $1 ]; then
    echo "0"
  else
    cat $1
  fi
}
result=$(get_run_time "/nonexistent/file")
echo "$result"
EOF
  chmod +x "$TEST_TEMP_DIR/test_get_run_time.sh"
  run "$TEST_TEMP_DIR/test_get_run_time.sh"
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
}

@test "bootstrap lock prevents concurrent runs" {
  # Create a test script that simulates the locking mechanism
  cat > "$TEST_TEMP_DIR/test_lock.sh" << 'EOF'
#!/bin/bash
lock_file="$1"
exec 200>"$lock_file"

if flock -n 200; then
  echo "lock_acquired"
  sleep 2
else
  echo "lock_blocked"
fi
EOF
  chmod +x "$TEST_TEMP_DIR/test_lock.sh"
  
  # Start first process in background
  "$TEST_TEMP_DIR/test_lock.sh" "$TEST_TEMP_DIR/test.lock" &
  first_pid=$!
  sleep 0.5
  
  # Try to acquire lock in second process
  run "$TEST_TEMP_DIR/test_lock.sh" "$TEST_TEMP_DIR/test.lock"
  
  # Clean up
  wait $first_pid 2>/dev/null || true
  
  [ "$output" = "lock_blocked" ]
}

# ---------------------------------------------------------------------------
# Behavior: container-start.sh run against a mock toolbox
# ---------------------------------------------------------------------------

run_container_start() {
  cp "$PROJECT_ROOT/.devcontainer/container-start.sh" "$MOCK_TOOLBOX/.devcontainer/container-start.sh"
  mkdir -p "$MOCK_TOOLBOX/.runtime" "$MOCK_TOOLBOX/repos/x"
  run bash "$MOCK_TOOLBOX/.devcontainer/container-start.sh"
}

@test "container-start.sh fails and says so when bootstrap fails" {
  printf '#!/bin/bash\necho "Bootstrap running"\nexit 7\n' > "$MOCK_TOOLBOX/.devcontainer/bootstrap.sh"
  run_container_start
  [ "$status" -eq 7 ]
  [[ "$output" == *"Bootstrap failed (exit 7)"* ]]
  [[ "$output" != *"Bootstrap script executed"* ]]
}

@test "a failed bootstrap leaves the next start to run bootstrap again" {
  # First start: bootstrap dies before writing the markers.
  printf '#!/bin/bash\nexit 1\n' > "$MOCK_TOOLBOX/.devcontainer/bootstrap.sh"
  run_container_start
  [ "$status" -ne 0 ]
  # Second start with a working bootstrap must run it, not the startup path.
  cat > "$MOCK_TOOLBOX/.devcontainer/bootstrap.sh" <<'INNER'
#!/bin/bash
echo "Bootstrap running"
date +%s > "$HOME/.bootstrap_container_time"
cp "$HOME/.bootstrap_container_time" "$(dirname "$0")/../.runtime/.bootstrap_run_time"
INNER
  run_container_start
  [ "$status" -eq 0 ]
  [[ "$output" == *"Bootstrap running"* ]]
  [[ "$output" != *"Startup running"* ]]
}

@test "a completed bootstrap goes to startup.sh and the lock file is kept" {
  date +%s > "$HOME/.bootstrap_container_time"
  cp "$HOME/.bootstrap_container_time" "$MOCK_TOOLBOX/.runtime/.bootstrap_run_time" 2>/dev/null || {
    mkdir -p "$MOCK_TOOLBOX/.runtime"; cp "$HOME/.bootstrap_container_time" "$MOCK_TOOLBOX/.runtime/.bootstrap_run_time"; }
  touch "$HOME/.bootstrap.lock"
  run_container_start
  [ "$status" -eq 0 ]
  [[ "$output" == *"Startup running"* ]]
  [ -f "$HOME/.bootstrap.lock" ]
}

@test "the lock file survives a successful bootstrap run" {
  cat > "$MOCK_TOOLBOX/.devcontainer/bootstrap.sh" <<'INNER'
#!/bin/bash
date +%s > "$HOME/.bootstrap_container_time"
cp "$HOME/.bootstrap_container_time" "$(dirname "$0")/../.runtime/.bootstrap_run_time"
INNER
  run_container_start
  [ "$status" -eq 0 ]
  [ -f "$HOME/.bootstrap.lock" ]
}

@test "bootstrap and startup children do not inherit the lock descriptors" {
  cat > "$MOCK_TOOLBOX/.devcontainer/bootstrap.sh" <<'INNER'
#!/bin/bash
for fd in 200 201; do [ -e "/proc/self/fd/$fd" ] && echo "bootstrap-fd$fd-open"; done
echo "bootstrap-fds-checked"
date +%s > "$HOME/.bootstrap_container_time"
cp "$HOME/.bootstrap_container_time" "$(dirname "$0")/../.runtime/.bootstrap_run_time"
INNER
  run_container_start
  [[ "$output" == *"bootstrap-fds-checked"* ]]
  [[ "$output" != *"-open"* ]]
}

@test "one marker present and one missing counts as not completed: bootstrap runs again" {
  date +%s > "$HOME/.bootstrap_container_time"   # no repo marker
  cat > "$MOCK_TOOLBOX/.devcontainer/bootstrap.sh" <<'INNER'
#!/bin/bash
echo "Bootstrap running"
date +%s > "$HOME/.bootstrap_container_time"
cp "$HOME/.bootstrap_container_time" "$(dirname "$0")/../.runtime/.bootstrap_run_time"
INNER
  chmod +x "$MOCK_TOOLBOX/.devcontainer/bootstrap.sh"
  run_container_start
  [ "$status" -eq 0 ]
  [[ "$output" == *"Bootstrap running"* ]]
  [[ "$output" != *"Startup running"* ]]
}

@test "markers that disagree count as not completed: bootstrap runs again" {
  mkdir -p "$MOCK_TOOLBOX/.runtime"
  echo 111 > "$HOME/.bootstrap_container_time"
  echo 222 > "$MOCK_TOOLBOX/.runtime/.bootstrap_run_time"
  cat > "$MOCK_TOOLBOX/.devcontainer/bootstrap.sh" <<'INNER'
#!/bin/bash
echo "Bootstrap running"
date +%s > "$HOME/.bootstrap_container_time"
cp "$HOME/.bootstrap_container_time" "$(dirname "$0")/../.runtime/.bootstrap_run_time"
INNER
  chmod +x "$MOCK_TOOLBOX/.devcontainer/bootstrap.sh"
  run_container_start
  [ "$status" -eq 0 ]
  [[ "$output" == *"Bootstrap running"* ]]
}

@test "startup.sh, like bootstrap, is started without the lock descriptors" {
  mkdir -p "$MOCK_TOOLBOX/.runtime"
  date +%s > "$HOME/.bootstrap_container_time"
  cp "$HOME/.bootstrap_container_time" "$MOCK_TOOLBOX/.runtime/.bootstrap_run_time"
  cat > "$MOCK_TOOLBOX/.devcontainer/startup.sh" <<'INNER'
#!/bin/bash
for fd in 200 201; do [ -e "/proc/self/fd/$fd" ] && echo "startup-fd$fd-open"; done
echo "startup-fds-checked"
INNER
  chmod +x "$MOCK_TOOLBOX/.devcontainer/startup.sh"
  run_container_start
  [[ "$output" == *"startup-fds-checked"* ]]
  [[ "$output" != *"-open"* ]]
}

# Behavior: run the real bootstrap tasks from a mock toolbox (the paths resolve from
# the script that sources bootstrap.bash), with HOME in a scratch directory.
_bootstrap_driver() {   # <body of the driver, after bootstrap.bash is sourced>
  mkdir -p "$MOCK_TOOLBOX/.devcontainer" "$MOCK_TOOLBOX/.runtime"
  cp "$PROJECT_ROOT/.devcontainer/bootstrap.bash" "$MOCK_TOOLBOX/.devcontainer/"
  cat > "$MOCK_TOOLBOX/.devcontainer/driver.sh" <<DRIVER
#!/bin/bash
source "\$(dirname "\$0")/bootstrap.bash"
$1
DRIVER
  chmod +x "$MOCK_TOOLBOX/.devcontainer/driver.sh"
}

@test "init_bootstrap_run_time clears the real markers it resolves itself" {
  _bootstrap_driver 'init_bootstrap_run_time'
  echo 1 > "$HOME/.bootstrap_container_time"; echo 1 > "$MOCK_TOOLBOX/.runtime/.bootstrap_run_time"
  run bash "$MOCK_TOOLBOX/.devcontainer/driver.sh"
  [ "$status" -eq 0 ]
  [ ! -e "$HOME/.bootstrap_container_time" ]
  [ ! -e "$MOCK_TOOLBOX/.runtime/.bootstrap_run_time" ]
}

@test "the markers stay absent when a task after init_bootstrap_run_time fails" {
  _bootstrap_driver 'failing_task() { return 1; }
run_bootstrap_tasks init_bootstrap_run_time failing_task'
  echo 1 > "$HOME/.bootstrap_container_time"; echo 1 > "$MOCK_TOOLBOX/.runtime/.bootstrap_run_time"
  run bash "$MOCK_TOOLBOX/.devcontainer/driver.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"Task failed: failing_task"* ]]
  [ ! -e "$HOME/.bootstrap_container_time" ]
  [ ! -e "$MOCK_TOOLBOX/.runtime/.bootstrap_run_time" ]
}

@test "init_bootstrap_run_time comes before initialize_paths in the default task list" {
  local list init_line paths_line
  list="$(sed -n '/local default_tasks=(/,/^    )/p' "$PROJECT_ROOT/.devcontainer/bootstrap.bash")"
  init_line="$(printf '%s\n' "$list" | grep -n '^ *init_bootstrap_run_time$' | cut -d: -f1)"
  paths_line="$(printf '%s\n' "$list" | grep -n '^ *initialize_paths$' | cut -d: -f1)"
  [ -n "$init_line" ] && [ -n "$paths_line" ] && [ "$init_line" -lt "$paths_line" ]
}
