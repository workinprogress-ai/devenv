#!/usr/bin/env bats

setup() {
  export DEVENV_ROOT="/workspaces/devenv"
  load "${DEVENV_ROOT}/tools/tests/test_helper"
}

# Test SMB operations
@test "get_smb_host returns configured value" {
  source "${DEVENV_ROOT}/tools/lib/server-operations.bash"
  
  export SMB_HOST="smb.example.com"
  result=$(get_smb_host)
  [[ "$result" == "smb.example.com" ]]
  unset SMB_HOST
}

@test "get_smb_share returns configured value" {
  source "${DEVENV_ROOT}/tools/lib/server-operations.bash"
  
  export SMB_SHARE="shared"
  result=$(get_smb_share)
  [[ "$result" == "shared" ]]
  unset SMB_SHARE
}

@test "get_smb_mount_point returns configured or default" {
  source "${DEVENV_ROOT}/tools/lib/server-operations.bash"
  
  unset SMB_MOUNT_POINT
  result=$(get_smb_mount_point)
  [[ "$result" == "/mnt/smb" ]]
}

@test "get_smb_host returns empty when not configured" {
  source "${DEVENV_ROOT}/tools/lib/server-operations.bash"
  
  unset SMB_HOST
  result=$(get_smb_host)
  [[ -z "$result" ]]
}

@test "get_smb_share returns empty when not configured" {
  source "${DEVENV_ROOT}/tools/lib/server-operations.bash"
  
  unset SMB_SHARE
  result=$(get_smb_share)
  [[ -z "$result" ]]
}

@test "is_smb_available returns false when host or share not configured" {
  source "${DEVENV_ROOT}/tools/lib/server-operations.bash"
  
  unset SMB_HOST SMB_SHARE
  ! is_smb_available
}

# Test SMB functions
@test "mount_smb_share function exists" {
  source "${DEVENV_ROOT}/tools/lib/server-operations.bash"
  declare -f mount_smb_share >/dev/null
}

@test "unmount_smb_share function exists" {
  source "${DEVENV_ROOT}/tools/lib/server-operations.bash"
  declare -f unmount_smb_share >/dev/null
}

@test "unmount_smb_share with non-existent mount point" {
  source "${DEVENV_ROOT}/tools/lib/server-operations.bash"
  
  # Should return 0 since it's idempotent
  unmount_smb_share "/nonexistent/mount" >/dev/null 2>&1
  [[ $? -eq 0 ]]
}

@test "mount_smb_share fails when host not configured" {
  source "${DEVENV_ROOT}/tools/lib/server-operations.bash"
  
  unset SMB_HOST SMB_SHARE
  ! mount_smb_share "/tmp/test" >/dev/null 2>&1
}

# Test library exports
@test "all server-operations functions are exported" {
  source "${DEVENV_ROOT}/tools/lib/server-operations.bash"
  
  declare -f get_smb_host >/dev/null
  declare -f get_smb_share >/dev/null
  declare -f is_smb_available >/dev/null
  declare -f mount_smb_share >/dev/null
  declare -f unmount_smb_share >/dev/null
}

@test "server-operations library loads without errors" {
  source "${DEVENV_ROOT}/tools/lib/server-operations.bash"
  [[ -n "$_SERVER_OPERATIONS_LOADED" ]]
}
