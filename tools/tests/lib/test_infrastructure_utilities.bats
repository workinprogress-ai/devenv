#!/usr/bin/env bats

setup() {
  export DEVENV_ROOT="/workspaces/devenv"
  load "${DEVENV_ROOT}/tools/tests/test_helper"
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

# Test tunneling
@test "forward_local_port function exists" {
  source "${DEVENV_ROOT}/tools/lib/infrastructure-utilities.bash"
  declare -f forward_local_port >/dev/null
}

@test "setup_tunnel function exists" {
  source "${DEVENV_ROOT}/tools/lib/infrastructure-utilities.bash"
  declare -f setup_tunnel >/dev/null
}

@test "teardown_tunnel function exists" {
  source "${DEVENV_ROOT}/tools/lib/infrastructure-utilities.bash"
  declare -f teardown_tunnel >/dev/null
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
