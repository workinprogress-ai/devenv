#!/bin/bash

################################################################################
# container-operations.bash
#
# Library for Docker/container management operations.
# Handles Docker builds, startup/shutdown, and container debugging.
#
# Dependencies:
#   - error-handling.bash (logging and error utilities)
#   - validation.bash (validation functions)
#
# Functions exported:
#   - is_docker_available()
#   - get_docker_compose_file()
#   - docker_is_running()
#   - docker_compose_up()
#   - docker_compose_down()
#   - docker_build_image()
#   - docker_get_image_id()
#   - docker_image_exists()
#   - docker_container_exists()
#   - docker_container_is_running()
#   - docker_get_container_id()
#   - docker_enable_debugger()
#   - docker_disable_debugger()
#   - docker_exec_command()
#   - docker_get_container_logs()
#
################################################################################

# Prevent double-sourcing
if [[ "${_CONTAINER_OPERATIONS_LOADED:-}" == "true" ]]; then
  return
fi
_CONTAINER_OPERATIONS_LOADED="true"

# Source dependencies
# shellcheck source=/dev/null
source "${DEVENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/tools/lib/error-handling.bash"
# shellcheck source=/dev/null
source "${DEVENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/tools/lib/validation.bash"

################################################################################
# Docker Availability & Configuration
################################################################################

is_docker_available() {
  command -v docker &>/dev/null && docker info >/dev/null 2>&1
}

# shellcheck disable=SC2120
get_docker_compose_file() {
  local search_dir="${1:-.}"
  
  if [[ -f "${search_dir}/docker-compose.yml" ]]; then
    echo "${search_dir}/docker-compose.yml"
  elif [[ -f "${search_dir}/docker-compose.yaml" ]]; then
    echo "${search_dir}/docker-compose.yaml"
  elif [[ -f "docker-compose.yml" ]]; then
    echo "docker-compose.yml"
  elif [[ -f "docker-compose.yaml" ]]; then
    echo "docker-compose.yaml"
  else
    return 1
  fi
}

docker_is_running() {
  docker ps >/dev/null 2>&1
}

################################################################################
# Docker Compose Operations
################################################################################

docker_compose_up() {
  # shellcheck disable=SC2119
  local compose_file="${1:-$(get_docker_compose_file)}"
  local detach="${2:-true}"
  
  if [[ ! -f "$compose_file" ]]; then
    error_msg "Docker compose file not found: $compose_file"
    return 1
  fi
  
  if ! is_docker_available; then
    error_msg "Docker is not available"
    return 1
  fi
  
  log_info "Starting Docker containers from: $compose_file"
  
  local compose_args=("-f" "$compose_file")
  
  if [[ "$detach" == "true" ]]; then
    compose_args+=("up" "-d")
  else
    compose_args+=("up")
  fi
  
  if docker compose "${compose_args[@]}" >/dev/null 2>&1; then
    log_success "Docker containers started successfully"
    return 0
  else
    error_msg "Failed to start Docker containers"
    return 1
  fi
}

docker_compose_down() {
  # shellcheck disable=SC2119
  local compose_file="${1:-$(get_docker_compose_file)}"
  
  if [[ ! -f "$compose_file" ]]; then
    error_msg "Docker compose file not found: $compose_file"
    return 1
  fi
  
  if ! is_docker_available; then
    error_msg "Docker is not available"
    return 1
  fi
  
  log_info "Stopping Docker containers from: $compose_file"
  
  if docker compose -f "$compose_file" down >/dev/null 2>&1; then
    log_success "Docker containers stopped successfully"
    return 0
  else
    error_msg "Failed to stop Docker containers"
    return 1
  fi
}

################################################################################
# Docker Image Operations
################################################################################

docker_build_image() {
  local dockerfile="${1:-.}"
  local image_name="$2"
  local tag="${3:-latest}"
  
  if [[ -z "$image_name" ]]; then
    error_msg "Image name is required"
    return 1
  fi
  
  if [[ ! -f "$dockerfile/Dockerfile" ]] && [[ ! -f "$dockerfile" ]]; then
    error_msg "Dockerfile not found: $dockerfile"
    return 1
  fi
  
  if ! is_docker_available; then
    error_msg "Docker is not available"
    return 1
  fi
  
  local full_image="${image_name}:${tag}"
  log_info "Building Docker image: $full_image"
  
  local docker_args=("build" "-t" "$full_image")
  
  if [[ -f "$dockerfile" ]]; then
    docker_args+=("-f" "$dockerfile")
    docker_args+=("$(dirname "$dockerfile")")
  else
    docker_args+=("$dockerfile")
  fi
  
  if docker "${docker_args[@]}" >/dev/null 2>&1; then
    log_success "Image built successfully: $full_image"
    return 0
  else
    error_msg "Failed to build image"
    return 1
  fi
}

docker_get_image_id() {
  local image_name="$1"
  
  if [[ -z "$image_name" ]]; then
    error_msg "Image name is required"
    return 1
  fi
  
  docker images --quiet "$image_name" 2>/dev/null | head -1
}

docker_image_exists() {
  local image_name="$1"
  
  if [[ -z "$image_name" ]]; then
    return 1
  fi
  
  [[ -n "$(docker_get_image_id "$image_name")" ]]
}

################################################################################
# Docker Container Operations
################################################################################

docker_container_exists() {
  local container_name="$1"
  
  if [[ -z "$container_name" ]]; then
    return 1
  fi
  
  docker ps -a --filter "name=^${container_name}\$" --quiet 2>/dev/null | grep -q .
}

docker_container_is_running() {
  local container_name="$1"
  
  if [[ -z "$container_name" ]]; then
    return 1
  fi
  
  docker ps --filter "name=^${container_name}\$" --quiet 2>/dev/null | grep -q .
}

docker_get_container_id() {
  local container_name="$1"
  
  if [[ -z "$container_name" ]]; then
    error_msg "Container name is required"
    return 1
  fi
  
  docker ps -a --filter "name=^${container_name}\$" --quiet 2>/dev/null | head -1
}

docker_exec_command() {
  local container_name="$1"
  shift
  local command=("$@")
  
  if [[ -z "$container_name" ]]; then
    error_msg "Container name is required"
    return 1
  fi
  
  if ! docker_container_is_running "$container_name"; then
    error_msg "Container is not running: $container_name"
    return 1
  fi
  
  docker exec "${container_name}" "${command[@]}"
}

docker_get_container_logs() {
  local container_name="$1"
  local lines="${2:-100}"
  
  if [[ -z "$container_name" ]]; then
    error_msg "Container name is required"
    return 1
  fi
  
  if ! docker_container_exists "$container_name"; then
    error_msg "Container does not exist: $container_name"
    return 1
  fi
  
  docker logs --tail "$lines" "$container_name"
}

################################################################################
# Docker Debugger Operations
################################################################################

docker_enable_debugger() {
  local container_name="$1"
  local debugger_port="${2:-5005}"
  
  if [[ -z "$container_name" ]]; then
    error_msg "Container name is required"
    return 1
  fi
  
  if ! docker_container_is_running "$container_name"; then
    error_msg "Container is not running: $container_name"
    return 1
  fi
  
  log_info "Enabling debugger on container: $container_name (port: $debugger_port)"
  
  # For .NET containers, enable debugging
  if docker_exec_command "$container_name" test -f /bin/bash >/dev/null 2>&1; then
    # Set environment variable for debugger
    if docker exec "$container_name" bash -c "VSDBG_ENABLED=true" >/dev/null 2>&1; then
      log_success "Debugger enabled successfully"
      return 0
    fi
  fi
  
  error_msg "Failed to enable debugger"
  return 1
}

docker_disable_debugger() {
  local container_name="$1"
  
  if [[ -z "$container_name" ]]; then
    error_msg "Container name is required"
    return 1
  fi
  
  if ! docker_container_exists "$container_name"; then
    error_msg "Container does not exist: $container_name"
    return 1
  fi
  
  log_info "Disabling debugger on container: $container_name"
  
  if docker_container_is_running "$container_name"; then
    docker exec "$container_name" bash -c "unset VSDBG_ENABLED" >/dev/null 2>&1
  fi
  
  log_success "Debugger disabled"
  return 0
}

# Export all functions
export -f is_docker_available
export -f get_docker_compose_file
export -f docker_is_running
export -f docker_compose_up
export -f docker_compose_down
export -f docker_build_image
export -f docker_get_image_id
export -f docker_image_exists
export -f docker_container_exists
export -f docker_container_is_running
export -f docker_get_container_id
export -f docker_exec_command
export -f docker_get_container_logs
export -f docker_enable_debugger
export -f docker_disable_debugger
