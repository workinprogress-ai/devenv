#!/bin/bash

################################################################################
# database-operations.bash
#
# Library for database operations including MongoDB and SQL Server.
# Handles backup, restore, and database server management.
#
# Dependencies:
#   - error-handling.bash (logging and error utilities)
#   - validation.bash (validation functions)
#
# Functions exported:
#   - get_mongo_host()
#   - get_mongo_port()
#   - get_mongo_username()
#   - get_mongo_password()
#   - get_mongo_connection_string()
#   - is_mongo_available()
#   - backup_mongo_database()
#   - restore_mongo_database()
#   - get_sql_host()
#   - get_sql_port()
#   - get_sql_username()
#   - get_sql_password()
#   - is_sql_available()
#
################################################################################

# Prevent double-sourcing
if [[ "${_DATABASE_OPERATIONS_LOADED:-}" == "true" ]]; then
  return
fi
_DATABASE_OPERATIONS_LOADED="true"

# Source dependencies
# shellcheck source=/dev/null
source "${DEVENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/tools/lib/error-handling.bash"
# shellcheck source=/dev/null
source "${DEVENV_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/tools/lib/validation.bash"

################################################################################
# MongoDB Connection Functions
################################################################################

get_mongo_host() {
  echo "${MONGO_HOST:-localhost}"
}

get_mongo_port() {
  echo "${MONGO_PORT:-27017}"
}

get_mongo_username() {
  echo "${MONGO_USERNAME:-}"
}

get_mongo_password() {
  echo "${MONGO_PASSWORD:-}"
}

get_mongo_connection_string() {
  local host port username password
  host="$(get_mongo_host)"
  port="$(get_mongo_port)"
  username="$(get_mongo_username)"
  password="$(get_mongo_password)"
  
  if [[ -n "$username" ]] && [[ -n "$password" ]]; then
    echo "mongodb://${username}:${password}@${host}:${port}"
  else
    echo "mongodb://${host}:${port}"
  fi
}

is_mongo_available() {
  local host port
  host="$(get_mongo_host)"
  port="$(get_mongo_port)"
  
  if command -v mongosh &>/dev/null; then
    mongosh --host "$host:$port" --eval "db.adminCommand('ping')" >/dev/null 2>&1
  elif command -v mongo &>/dev/null; then
    mongo --host "$host:$port" --eval "db.adminCommand('ping')" >/dev/null 2>&1
  else
    return 1
  fi
}

################################################################################
# MongoDB Backup/Restore Functions
################################################################################

backup_mongo_database() {
  local database="$1"
  local backup_path="${2:-.}"
  local backup_name="${3:-${database}_backup_$(date +%Y%m%d_%H%M%S)}"
  
  if [[ -z "$database" ]]; then
    error_msg "Database name is required"
    return 1
  fi
  
  if ! is_mongo_available; then
    error_msg "MongoDB is not available"
    return 1
  fi
  
  local host port username password
  host="$(get_mongo_host)"
  port="$(get_mongo_port)"
  username="$(get_mongo_username)"
  password="$(get_mongo_password)"
  
  log_info "Backing up MongoDB database: $database"
  
  local backup_dir="${backup_path}/${backup_name}"
  mkdir -p "$backup_dir"
  
  if command -v mongodump &>/dev/null; then
    local mongodump_args=("--host" "$host:$port" "--db" "$database" "--out" "$backup_dir")
    
    if [[ -n "$username" ]] && [[ -n "$password" ]]; then
      mongodump_args+=("--username" "$username" "--password" "$password" "--authenticationDatabase" "admin")
    fi
    
    if mongodump "${mongodump_args[@]}" >/dev/null 2>&1; then
      log_success "Database backup completed: $backup_dir"
      echo "$backup_dir"
      return 0
    else
      error_msg "Backup failed"
      return 1
    fi
  else
    error_msg "mongodump not found"
    return 1
  fi
}

restore_mongo_database() {
  local backup_path="$1"
  local database="${2:-}"
  
  if [[ -z "$backup_path" ]]; then
    error_msg "Backup path is required"
    return 1
  fi
  
  if [[ ! -d "$backup_path" ]]; then
    error_msg "Backup directory not found: $backup_path"
    return 1
  fi
  
  if ! is_mongo_available; then
    error_msg "MongoDB is not available"
    return 1
  fi
  
  local host port username password
  host="$(get_mongo_host)"
  port="$(get_mongo_port)"
  username="$(get_mongo_username)"
  password="$(get_mongo_password)"
  
  log_info "Restoring MongoDB database from: $backup_path"
  
  if command -v mongorestore &>/dev/null; then
    local mongorestore_args=("--host" "$host:$port" "--dir" "$backup_path")
    
    if [[ -n "$database" ]]; then
      mongorestore_args+=("--db" "$database")
    fi
    
    if [[ -n "$username" ]] && [[ -n "$password" ]]; then
      mongorestore_args+=("--username" "$username" "--password" "$password" "--authenticationDatabase" "admin")
    fi
    
    if mongorestore "${mongorestore_args[@]}" >/dev/null 2>&1; then
      log_success "Database restore completed"
      return 0
    else
      error_msg "Restore failed"
      return 1
    fi
  else
    error_msg "mongorestore not found"
    return 1
  fi
}

################################################################################
# SQL Server Connection Functions
################################################################################

get_sql_host() {
  echo "${SQL_HOST:-localhost}"
}

get_sql_port() {
  echo "${SQL_PORT:-1433}"
}

get_sql_username() {
  echo "${SQL_USERNAME:-sa}"
}

get_sql_password() {
  echo "${SQL_PASSWORD:-}"
}

is_sql_available() {
  local host port
  host="$(get_sql_host)"
  port="$(get_sql_port)"
  
  if command -v sqlcmd &>/dev/null; then
    sqlcmd -S "${host},${port}" -U "$(get_sql_username)" -P "$(get_sql_password)" \
      -Q "SELECT 1" >/dev/null 2>&1
  elif command -v mssql-cli &>/dev/null; then
    mssql-cli --server "$host" --username "$(get_sql_username)" \
      --password "$(get_sql_password)" -Q "SELECT 1" >/dev/null 2>&1
  else
    return 1
  fi
}

# Export all functions
export -f get_mongo_host
export -f get_mongo_port
export -f get_mongo_username
export -f get_mongo_password
export -f get_mongo_connection_string
export -f is_mongo_available
export -f backup_mongo_database
export -f restore_mongo_database
export -f get_sql_host
export -f get_sql_port
export -f get_sql_username
export -f get_sql_password
export -f is_sql_available
