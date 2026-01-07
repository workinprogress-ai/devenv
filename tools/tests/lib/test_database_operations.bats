#!/usr/bin/env bats

setup() {
  export DEVENV_ROOT="/workspaces/devenv"
  load "${DEVENV_ROOT}/tools/tests/test_helper"
}

# Test database connectivity
@test "get_mongo_host returns configured or default" {
  source "${DEVENV_ROOT}/tools/lib/database-operations.bash"
  
  unset MONGO_HOST
  result=$(get_mongo_host)
  [[ "$result" == "localhost" ]]
}

@test "get_mongo_port returns configured or default" {
  source "${DEVENV_ROOT}/tools/lib/database-operations.bash"
  
  unset MONGO_PORT
  result=$(get_mongo_port)
  [[ "$result" == "27017" ]]
}

@test "get_mongo_username returns configured value" {
  source "${DEVENV_ROOT}/tools/lib/database-operations.bash"
  
  export MONGO_USERNAME="testuser"
  result=$(get_mongo_username)
  [[ "$result" == "testuser" ]]
  unset MONGO_USERNAME
}

@test "get_mongo_password returns configured value" {
  source "${DEVENV_ROOT}/tools/lib/database-operations.bash"
  
  export MONGO_PASSWORD="testpass"
  result=$(get_mongo_password)
  [[ "$result" == "testpass" ]]
  unset MONGO_PASSWORD
}

# Test connection string building
@test "get_mongo_connection_string without auth" {
  source "${DEVENV_ROOT}/tools/lib/database-operations.bash"
  
  unset MONGO_USERNAME MONGO_PASSWORD
  export MONGO_HOST="testhost"
  export MONGO_PORT="27017"
  
  result=$(get_mongo_connection_string)
  [[ "$result" == "mongodb://testhost:27017" ]]
  
  unset MONGO_HOST MONGO_PORT
}

@test "get_mongo_connection_string with auth" {
  source "${DEVENV_ROOT}/tools/lib/database-operations.bash"
  
  export MONGO_HOST="testhost"
  export MONGO_PORT="27017"
  export MONGO_USERNAME="user"
  export MONGO_PASSWORD="pass"
  
  result=$(get_mongo_connection_string)
  [[ "$result" == "mongodb://user:pass@testhost:27017" ]]
  
  unset MONGO_HOST MONGO_PORT MONGO_USERNAME MONGO_PASSWORD
}

# Test SQL Server getters
@test "get_sql_host returns configured or default" {
  source "${DEVENV_ROOT}/tools/lib/database-operations.bash"
  
  unset SQL_HOST
  result=$(get_sql_host)
  [[ "$result" == "localhost" ]]
}

@test "get_sql_port returns configured or default" {
  source "${DEVENV_ROOT}/tools/lib/database-operations.bash"
  
  unset SQL_PORT
  result=$(get_sql_port)
  [[ "$result" == "1433" ]]
}

@test "get_sql_username returns configured or default" {
  source "${DEVENV_ROOT}/tools/lib/database-operations.bash"
  
  unset SQL_USERNAME
  result=$(get_sql_username)
  [[ "$result" == "sa" ]]
}

# Test backup/restore functions
@test "backup_mongo_database function exists" {
  source "${DEVENV_ROOT}/tools/lib/database-operations.bash"
  declare -f backup_mongo_database >/dev/null
}

@test "restore_mongo_database function exists" {
  source "${DEVENV_ROOT}/tools/lib/database-operations.bash"
  declare -f restore_mongo_database >/dev/null
}

# Test library exports
@test "all database-operations functions are exported" {
  source "${DEVENV_ROOT}/tools/lib/database-operations.bash"
  
  declare -f get_mongo_host >/dev/null
  declare -f is_mongo_available >/dev/null
  declare -f backup_mongo_database >/dev/null
  declare -f get_sql_host >/dev/null
}

@test "database-operations library loads without errors" {
  source "${DEVENV_ROOT}/tools/lib/database-operations.bash"
  [[ -n "$_DATABASE_OPERATIONS_LOADED" ]]
}
