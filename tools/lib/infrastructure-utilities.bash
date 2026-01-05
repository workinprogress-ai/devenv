#!/bin/bash

################################################################################
# infrastructure-utilities.bash
#
# Library for infrastructure and networking utilities.
# Handles port forwarding, tunneling, network diagnostics, and cloud operations.
#
# Dependencies:
#   - error-handling.bash (logging and error utilities)
#   - validation.bash (validation functions)
#
# Functions exported:
#   - is_port_in_use()
#   - find_free_port()
#   - get_local_ip()
#   - get_public_ip()
#   - check_host_connectivity()
#   - is_port_open()
#   - forward_local_port()
#   - check_service_health()
#   - wait_for_service()
#   - setup_tunnel()
#   - teardown_tunnel()
#
################################################################################

# Prevent double-sourcing
if [[ "${_INFRASTRUCTURE_UTILITIES_LOADED:-}" == "true" ]]; then
  return
fi
_INFRASTRUCTURE_UTILITIES_LOADED="true"

# Source dependencies
# shellcheck source=/dev/null
source "${DEVENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/tools/lib/error-handling.bash"
# shellcheck source=/dev/null
source "${DEVENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/tools/lib/validation.bash"

################################################################################
# Port & Network Utilities
################################################################################

is_port_in_use() {
  local port="$1"
  
  if [[ -z "$port" ]]; then
    error_msg "Port number is required"
    return 1
  fi
  
  if command -v lsof &>/dev/null; then
    lsof -i :"$port" >/dev/null 2>&1
  elif command -v netstat &>/dev/null; then
    netstat -tuln 2>/dev/null | grep -q ":$port "
  else
    return 1
  fi
}

find_free_port() {
  local start_port="${1:-8000}"
  local max_attempts="${2:-100}"
  local current_port="$start_port"
  local attempts=0
  
  while (( attempts < max_attempts )); do
    if ! is_port_in_use "$current_port"; then
      echo "$current_port"
      return 0
    fi
    current_port=$((current_port + 1))
    attempts=$((attempts + 1))
  done
  
  error_msg "Could not find free port in range $start_port-$((start_port + max_attempts))"
  return 1
}

get_local_ip() {
  local interface="${1:-eth0}"
  
  if command -v ip &>/dev/null; then
    ip addr show "$interface" 2>/dev/null \
      | grep "inet " \
      | awk '{print $2}' \
      | cut -d'/' -f1 \
      | head -1
  elif command -v ifconfig &>/dev/null; then
    ifconfig "$interface" 2>/dev/null \
      | grep "inet " \
      | awk '{print $2}' \
      | head -1
  else
    hostname -I | awk '{print $1}'
  fi
}

get_public_ip() {
  # Try multiple public IP services with fallback
  if command -v curl &>/dev/null; then
    curl -s https://api.ipify.org 2>/dev/null && return 0
    curl -s https://checkip.amazonaws.com 2>/dev/null && return 0
    curl -s http://icanhazip.com 2>/dev/null && return 0
  fi
  
  if command -v wget &>/dev/null; then
    wget -qO- https://api.ipify.org 2>/dev/null && return 0
    wget -qO- https://checkip.amazonaws.com 2>/dev/null && return 0
  fi
  
  error_msg "Could not determine public IP"
  return 1
}

################################################################################
# Connectivity & Health Checks
################################################################################

check_host_connectivity() {
  local host="$1"
  local timeout="${2:-5}"
  
  if [[ -z "$host" ]]; then
    error_msg "Host is required"
    return 1
  fi
  
  if command -v ping &>/dev/null; then
    ping -c 1 -W "$timeout" "$host" >/dev/null 2>&1
  elif command -v nc &>/dev/null; then
    nc -z -w "$timeout" "$host" 80 >/dev/null 2>&1 || \
    nc -z -w "$timeout" "$host" 443 >/dev/null 2>&1
  else
    return 1
  fi
}

is_port_open() {
  local host="$1"
  local port="$2"
  local timeout="${3:-5}"
  
  if [[ -z "$host" ]] || [[ -z "$port" ]]; then
    error_msg "Host and port are required"
    return 1
  fi
  
  if command -v nc &>/dev/null; then
    nc -z -w "$timeout" "$host" "$port" >/dev/null 2>&1
  elif command -v timeout &>/dev/null && command -v bash &>/dev/null; then
    timeout "$timeout" bash -c "</dev/null >/dev/null 2>&1 <>/dev/tcp/${host}/${port}" >/dev/null 2>&1
  else
    return 1
  fi
}

check_service_health() {
  local service_url="$1"
  local expected_status="${2:-200}"
  
  if [[ -z "$service_url" ]]; then
    error_msg "Service URL is required"
    return 1
  fi
  
  if command -v curl &>/dev/null; then
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" "$service_url" 2>/dev/null)
    [[ "$status" == "$expected_status" ]]
  else
    return 1
  fi
}

wait_for_service() {
  local service_url="$1"
  local max_attempts="${2:-30}"
  local delay="${3:-2}"
  local attempt=0
  
  if [[ -z "$service_url" ]]; then
    error_msg "Service URL is required"
    return 1
  fi
  
  log_info "Waiting for service to be available: $service_url"
  
  while (( attempt < max_attempts )); do
    if check_service_health "$service_url"; then
      log_success "Service is available"
      return 0
    fi
    
    attempt=$((attempt + 1))
    if (( attempt < max_attempts )); then
      sleep "$delay"
    fi
  done
  
  error_msg "Service did not become available within timeout"
  return 1
}

################################################################################
# Port Forwarding & Tunneling
################################################################################

forward_local_port() {
  local local_port="$1"
  local remote_host="$2"
  local remote_port="$3"
  local bind_address="${4:-127.0.0.1}"
  
  if [[ -z "$local_port" ]] || [[ -z "$remote_host" ]] || [[ -z "$remote_port" ]]; then
    error_msg "Local port, remote host, and remote port are required"
    return 1
  fi
  
  if is_port_in_use "$local_port"; then
    error_msg "Local port is already in use: $local_port"
    return 1
  fi
  
  if ! command -v socat &>/dev/null && ! command -v nc &>/dev/null; then
    error_msg "Port forwarding requires socat or nc"
    return 1
  fi
  
  log_info "Forwarding local port $local_port -> $remote_host:$remote_port"
  
  if command -v socat &>/dev/null; then
    socat "TCP-LISTEN:${local_port},bind=${bind_address},reuseaddr,fork" \
      "TCP:${remote_host}:${remote_port}" &
    echo $!
    return 0
  fi
  
  error_msg "No suitable port forwarding tool found"
  return 1
}

setup_tunnel() {
  local tunnel_type="$1"
  local local_port="$2"
  local remote_host="$3"
  local remote_port="$4"
  
  if [[ -z "$tunnel_type" ]] || [[ -z "$local_port" ]] || [[ -z "$remote_host" ]] || [[ -z "$remote_port" ]]; then
    error_msg "Tunnel type, local port, remote host, and remote port are required"
    return 1
  fi
  
  case "$tunnel_type" in
    ssh)
      log_info "Setting up SSH tunnel: localhost:$local_port -> $remote_host:$remote_port"
      ssh -N -L "${local_port}:${remote_host}:${remote_port}" &
      echo $!
      ;;
    http)
      forward_local_port "$local_port" "$remote_host" "$remote_port"
      ;;
    *)
      error_msg "Unknown tunnel type: $tunnel_type"
      return 1
      ;;
  esac
}

teardown_tunnel() {
  local pid="$1"
  
  if [[ -z "$pid" ]]; then
    error_msg "Process ID is required"
    return 1
  fi
  
  if kill "$pid" 2>/dev/null; then
    log_info "Tunnel process terminated: $pid"
    return 0
  else
    error_msg "Failed to terminate tunnel process: $pid"
    return 1
  fi
}

# Export all functions
export -f is_port_in_use
export -f find_free_port
export -f get_local_ip
export -f get_public_ip
export -f check_host_connectivity
export -f is_port_open
export -f check_service_health
export -f wait_for_service
export -f forward_local_port
export -f setup_tunnel
export -f teardown_tunnel
