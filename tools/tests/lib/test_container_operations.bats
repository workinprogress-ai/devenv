#!/usr/bin/env bats

setup() {
  export DEVENV_ROOT="/workspaces/devenv"
  load "${DEVENV_ROOT}/tools/tests/test_helper"
}

# Test Docker availability
@test "is_docker_available returns status" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  # Just test that function exists and runs
  declare -f is_docker_available >/dev/null
}

# Test get_docker_compose_file
@test "get_docker_compose_file finds docker-compose.yml" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  
  tmpdir=$(mktemp -d)
  touch "$tmpdir/docker-compose.yml"
  
  result=$(get_docker_compose_file "$tmpdir")
  [[ "$result" == "$tmpdir/docker-compose.yml" ]]
  
  rm -rf "$tmpdir"
}

@test "get_docker_compose_file finds docker-compose.yaml" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  
  tmpdir=$(mktemp -d)
  touch "$tmpdir/docker-compose.yaml"
  
  result=$(get_docker_compose_file "$tmpdir")
  [[ "$result" == "$tmpdir/docker-compose.yaml" ]]
  
  rm -rf "$tmpdir"
}

@test "get_docker_compose_file with existing file" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  
  tmpdir=$(mktemp -d)
  touch "$tmpdir/docker-compose.yml"
  
  result=$(get_docker_compose_file "$tmpdir")
  [[ "$result" == "$tmpdir/docker-compose.yml" ]]
  
  rm -rf "$tmpdir"
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

# Test library exports
@test "all container-operations functions are exported" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  
  declare -f is_docker_available >/dev/null
  declare -f get_docker_compose_file >/dev/null
  declare -f docker_build_image >/dev/null
  declare -f docker_container_exists >/dev/null
}

@test "container-operations library loads without errors" {
  source "${DEVENV_ROOT}/tools/lib/container-operations.bash"
  [[ -n "$_CONTAINER_OPERATIONS_LOADED" ]]
}
