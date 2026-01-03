#!/usr/bin/env bats
# Tests for container-start.sh locking mechanism and bootstrap coordination

bats_require_minimum_version 1.5.0

load test_helper

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
date +%s > "$HOME/.bootstrap_run_time"
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
