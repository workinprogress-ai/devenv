#!/bin/bash

################################################################################
# server-operations.bash
#
# Library for server operations including SMB/file share management.
# Handles mounting, unmounting, and checking SMB shares.
#
# Dependencies:
#   - error-handling.bash (logging and error utilities)
#
# Functions exported:
#   - get_smb_host()
#   - get_smb_share()
#   - get_smb_mount_point()
#   - is_smb_available()
#   - mount_smb_share()
#   - unmount_smb_share()
#
################################################################################

# Prevent double-sourcing
if [[ "${_SERVER_OPERATIONS_LOADED:-}" == "true" ]]; then
  return
fi
_SERVER_OPERATIONS_LOADED="true"

# Source dependencies
# shellcheck source=/dev/null
source "${DEVENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/tools/lib/error-handling.bash"

################################################################################
# SMB/File Share Functions
################################################################################

get_smb_host() {
  echo "${SMB_HOST:-}"
}

get_smb_share() {
  echo "${SMB_SHARE:-}"
}

get_smb_mount_point() {
  echo "${SMB_MOUNT_POINT:-/mnt/smb}"
}

is_smb_available() {
  local host share
  host="$(get_smb_host)"
  share="$(get_smb_share)"
  
  if [[ -z "$host" ]] || [[ -z "$share" ]]; then
    return 1
  fi
  
  if command -v smbclient &>/dev/null; then
    smbclient -L "//${host}/${share}" -N >/dev/null 2>&1
  else
    return 1
  fi
}

mount_smb_share() {
  local mount_point="${1:-$(get_smb_mount_point)}"
  local host share username password
  
  host="$(get_smb_host)"
  share="$(get_smb_share)"
  username="${SMB_USERNAME:-}"
  password="${SMB_PASSWORD:-}"
  
  if [[ -z "$host" ]] || [[ -z "$share" ]]; then
    error_msg "SMB_HOST and SMB_SHARE environment variables required"
    return 1
  fi
  
  log_info "Mounting SMB share: //${host}/${share} to ${mount_point}"
  
  mkdir -p "$mount_point"
  
  local mount_args=("-t" "cifs" "-o" "uid=1000,gid=1000,forceuid,forcegid,nounix,iocharset=utf8")
  
  if [[ -n "$username" ]] && [[ -n "$password" ]]; then
    mount_args+=("-o" "username=${username},password=${password}")
  fi
  
  if sudo mount "${mount_args[@]}" "//${host}/${share}" "$mount_point" >/dev/null 2>&1; then
    log_success "SMB share mounted successfully"
    return 0
  else
    error_msg "Failed to mount SMB share"
    return 1
  fi
}

unmount_smb_share() {
  local mount_point="${1:-$(get_smb_mount_point)}"
  
  if [[ ! -d "$mount_point" ]]; then
    log_info "Mount point does not exist: $mount_point"
    return 0
  fi
  
  log_info "Unmounting SMB share: $mount_point"
  
  if sudo umount "$mount_point" >/dev/null 2>&1; then
    log_success "SMB share unmounted successfully"
    return 0
  else
    error_msg "Failed to unmount SMB share"
    return 1
  fi
}

# Export all functions
export -f get_smb_host
export -f get_smb_share
export -f get_smb_mount_point
export -f is_smb_available
export -f mount_smb_share
export -f unmount_smb_share
