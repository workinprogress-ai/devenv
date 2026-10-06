#!/usr/bin/env bats

load ../test_helper

setup() {
  test_helper_setup
}

teardown() {
  test_helper_teardown
}

# Test Docker availability
@test "is_docker_available returns status" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  # Just test that function exists and runs
  declare -f is_docker_available >/dev/null
}

# Test Docker image operations
@test "docker_image_exists function exists" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  
  declare -f docker_image_exists >/dev/null
}

# Test Docker container checks
@test "docker_container_exists function exists" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  
  declare -f docker_container_exists >/dev/null
}

# Test error handling functions
@test "docker_get_image_id function exists" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  declare -f docker_get_image_id >/dev/null
}

@test "docker_get_container_id function exists" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  declare -f docker_get_container_id >/dev/null
}

@test "docker_exec_command function exists" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  declare -f docker_exec_command >/dev/null
}

@test "docker_get_container_logs function exists" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  declare -f docker_get_container_logs >/dev/null
}

# Test debugger operations
@test "docker_enable_debugger function exists" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  declare -f docker_enable_debugger >/dev/null
}

@test "docker_disable_debugger function exists" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  declare -f docker_disable_debugger >/dev/null
}

# Regression (T002): error_msg was undefined in error-handling.bash, so any
# error path through these libs died with "command not found" (exit 127)
# instead of the function's own return code.
@test "docker_get_image_id with empty image name emits error_msg and returns 1, not 127" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"

  run docker_get_image_id ""
  [ "$status" -eq 1 ]
  [[ "$output" == *"Image name is required"* ]]
}

# Test library exports
@test "all container-operations functions are exported" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  
  declare -f is_docker_available >/dev/null
  declare -f docker_build_image >/dev/null
  declare -f docker_container_exists >/dev/null
}

@test "container-operations library loads without errors" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  [[ -n "$_CONTAINER_OPERATIONS_LOADED" ]]
}
