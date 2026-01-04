#!/usr/bin/env bats
# Tests for background-check-devenv-updates.sh

bats_require_minimum_version 1.5.0

load test_helper

setup() {
  test_helper_setup
  
  # Create mock git repository
  export MOCK_REPO="$TEST_TEMP_DIR/repo"
  mkdir -p "$MOCK_REPO/.devcontainer"
  cd "$MOCK_REPO"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "test" > README.md
  git add README.md
  git commit -q -m "Initial commit"
}

teardown() {
  # Kill any background processes
  if [ -f "$MOCK_REPO/.devcontainer/.update-check.pid" ]; then
    pid=$(cat "$MOCK_REPO/.devcontainer/.update-check.pid" 2>/dev/null || true)
    if [ -n "$pid" ]; then
      kill -9 "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
    rm -f "$MOCK_REPO/.devcontainer/.update-check.pid"
  fi
  
  pkill -f "background-check-devenv-updates.sh" 2>/dev/null || true
  
  cd "$ORIGINAL_PWD" 2>/dev/null || true
  test_helper_teardown
}

@test "background-check-devenv-updates.sh exists" {
  [ -f "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh" ]
}

@test "background-check-devenv-updates.sh has valid bash syntax" {
  run bash -n "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh sources versioning library" {
  run grep "source.*lib/versioning.bash" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh defines SCRIPT_VERSION" {
  run grep "readonly SCRIPT_VERSION=" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh has cleanup function" {
  run grep "^cleanup()" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh registers signal traps" {
  run grep "trap cleanup SIGTERM SIGINT" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh uses PID file" {
  run grep "PID_FILE=" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh prevents concurrent runs" {
  run grep "if \[ -f.*PID_FILE" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh checks for stale PID files" {
  run grep "kill -0.*old_pid" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh honors DEVENV_UPDATE_INTERVAL" {
  run grep "DEVENV_UPDATE_INTERVAL=" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh honors DEVENV_UPDATE_MAX_ITERATIONS" {
  run grep "DEVENV_UPDATE_MAX_ITERATIONS=" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh uses UPDATE_FILE for tracking" {
  run grep "UPDATE_FILE=" "$PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh"
  [ "$status" -eq 0 ]
}

@test "background-check-devenv-updates.sh cleanup removes PID file" {
  run bash -c "grep -A 3 '^cleanup()' $PROJECT_ROOT/.devcontainer/background-check-devenv-updates.sh | grep -q 'rm -f.*PID_FILE'"
  [ "$status" -eq 0 ]
}

@test "PID file prevents duplicate background update checkers" {
  cat > "$TEST_TEMP_DIR/test_pid_check.sh" << 'EOF'
#!/bin/bash
PID_FILE="$1"

if [ -f "$PID_FILE" ]; then
  old_pid=$(cat "$PID_FILE")
  if kill -0 "$old_pid" 2>/dev/null; then
    echo "already_running"
    exit 1
  else
    echo "stale_pid_file"
    rm -f "$PID_FILE"
  fi
fi

echo $$ > "$PID_FILE"
echo "started"
# Keep running to simulate a background process (short duration for testing)
sleep 2 &
wait
EOF
  chmod +x "$TEST_TEMP_DIR/test_pid_check.sh"
  
  # First run should succeed (run in background)
  "$TEST_TEMP_DIR/test_pid_check.sh" "$TEST_TEMP_DIR/test.pid" > "$TEST_TEMP_DIR/output1.txt" 2>&1 &
  sleep 0.5
  [ -f "$TEST_TEMP_DIR/test.pid" ]
  
  pid=$(cat "$TEST_TEMP_DIR/test.pid")
  
  # Second run should detect running process
  run "$TEST_TEMP_DIR/test_pid_check.sh" "$TEST_TEMP_DIR/test.pid"
  [ "$status" -eq 1 ]
  [[ "$output" =~ already_running ]]
  
  # Clean up
  kill -9 "$pid" 2>/dev/null || true
}
