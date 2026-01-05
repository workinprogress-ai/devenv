#!/usr/bin/env bash
# Centralized error handling and logging library
# Provides standardized error messages, exit codes, and logging utilities

# Guard against multiple sourcing
if [ -n "${_ERROR_HANDLING_LOADED:-}" ]; then
    return 0
fi
_ERROR_HANDLING_LOADED=1

# Exit codes - following standard conventions
# shellcheck disable=SC2034  # Variables exported for use by sourcing scripts
export EXIT_SUCCESS=0
export EXIT_GENERAL_ERROR=1
export EXIT_MISUSE=2
export EXIT_INVALID_ARGUMENT=3
export EXIT_NOT_FOUND=4
export EXIT_PERMISSION_DENIED=5
export EXIT_TIMEOUT=124
export EXIT_COMMAND_NOT_FOUND=127
export EXIT_INVALID_EXIT=128

# Track if strict mode is enabled
ERROR_HANDLING_STRICT_MODE_ENABLED=0

# Log levels
readonly LOG_LEVEL_DEBUG=0
readonly LOG_LEVEL_INFO=1
readonly LOG_LEVEL_WARN=2
readonly LOG_LEVEL_ERROR=3
readonly LOG_LEVEL_FATAL=4

# Current log level (default: INFO). Honor DEBUG=1 if ERROR_HANDLING_LOG_LEVEL is not explicitly set.
if [ "${DEBUG:-0}" -eq 1 ] && [ -z "${ERROR_HANDLING_LOG_LEVEL+x}" ]; then
    ERROR_HANDLING_LOG_LEVEL=$LOG_LEVEL_DEBUG
else
    ERROR_HANDLING_LOG_LEVEL=${ERROR_HANDLING_LOG_LEVEL:-$LOG_LEVEL_INFO}
fi

# ANSI color codes
readonly COLOR_RESET='\033[0m'
readonly COLOR_RED='\033[0;31m'
readonly COLOR_YELLOW='\033[0;33m'
readonly COLOR_BLUE='\033[0;34m'
readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_GRAY='\033[0;90m'

# Determine if we should use colors (only if output is a terminal)
use_colors() {
    [[ -t 2 ]] && [[ "${NO_COLOR:-}" != "1" ]]
}

# Get timestamp for logging
get_timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

# Log message with level
# Args:
#   $1 - Log level (DEBUG, INFO, WARN, ERROR, FATAL)
#   $2 - Message
#   $3+ - Additional context
log_message() {
    local level="$1"
    shift
    local message="$*"
    local timestamp
    timestamp="$(get_timestamp)"
    
    local level_num
    case "$level" in
        DEBUG) level_num=$LOG_LEVEL_DEBUG ;;
        INFO)  level_num=$LOG_LEVEL_INFO ;;
        WARN)  level_num=$LOG_LEVEL_WARN ;;
        ERROR) level_num=$LOG_LEVEL_ERROR ;;
        FATAL) level_num=$LOG_LEVEL_FATAL ;;
        *) level_num=$LOG_LEVEL_INFO ;;
    esac
    
    # Only log if level is high enough
    if [ "$level_num" -lt "$ERROR_HANDLING_LOG_LEVEL" ]; then
        return 0
    fi
    
    local color=""
    local reset=""
    if use_colors; then
        reset="$COLOR_RESET"
        case "$level" in
            DEBUG) color="$COLOR_GRAY" ;;
            INFO)  color="$COLOR_BLUE" ;;
            WARN)  color="$COLOR_YELLOW" ;;
            ERROR) color="$COLOR_RED" ;;
            FATAL) color="$COLOR_RED" ;;
        esac
    fi
    
    printf "${color}[%s] %-5s: %s${reset}\n" "$timestamp" "$level" "$message" >&2
}

# Convenience logging functions
log_debug() {
    log_message "DEBUG" "$@"
}

log_info() {
    log_message "INFO" "$@"
}

log_warn() {
    log_message "WARN" "$@"
}

log_error() {
    log_message "ERROR" "$@"
}

log_fatal() {
    log_message "FATAL" "$@"
}

# Print error message and exit with code
# Args:
#   $1 - Error message
#   $2 - Exit code (optional, defaults to EXIT_GENERAL_ERROR)
die() {
    local message="$1"
    local exit_code="${2:-$EXIT_GENERAL_ERROR}"
    
    log_fatal "$message"
    exit "$exit_code"
}

# Check if a command exists
# Args:
#   $1 - Command name
# Returns: 0 if exists, 1 if not
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Require a command to exist, exit if not
# Args:
#   $1 - Command name
#   $2 - Optional custom error message
require_command() {
    local cmd="$1"
    local message="${2:-Command '$cmd' is required but not found. Please install it.}"
    
    if ! command_exists "$cmd"; then
        die "$message" "$EXIT_COMMAND_NOT_FOUND"
    fi
}

# Require an environment variable to be set
# Args:
#   $1 - Variable name
#   $2 - Optional custom error message
require_env() {
    local var_name="$1"
    local message="${2:-Environment variable '$var_name' is required but not set.}"
    
    # Check if variable is set (not if it's non-empty)
    if [ -z "${!var_name+x}" ]; then
        die "$message" "$EXIT_INVALID_ARGUMENT"
    fi
}

# Check if a file exists, exit if not
# Args:
#   $1 - File path
#   $2 - Optional custom error message
require_file() {
    local file_path="$1"
    local message="${2:-Required file not found: $file_path}"
    
    if [ ! -f "$file_path" ]; then
        die "$message" "$EXIT_NOT_FOUND"
    fi
}

# Check if a directory exists, exit if not
# Args:
#   $1 - Directory path
#   $2 - Optional custom error message
require_directory() {
    local dir_path="$1"
    local message="${2:-Required directory not found: $dir_path}"
    
    if [ ! -d "$dir_path" ]; then
        die "$message" "$EXIT_NOT_FOUND"
    fi
}

# Check if user has permission to read/write a file
# Args:
#   $1 - File path
#   $2 - Permission type (r|w|x)
#   $3 - Optional custom error message
require_permission() {
    local file_path="$1"
    local perm_type="$2"
    local message="${3:-Permission denied: cannot $perm_type $file_path}"
    
    case "$perm_type" in
        r) [ -r "$file_path" ] || die "$message" "$EXIT_PERMISSION_DENIED" ;;
        w) [ -w "$file_path" ] || die "$message" "$EXIT_PERMISSION_DENIED" ;;
        x) [ -x "$file_path" ] || die "$message" "$EXIT_PERMISSION_DENIED" ;;
        *) die "Invalid permission type: $perm_type" "$EXIT_MISUSE" ;;
    esac
}

# Validate that a value is a positive integer
# Args:
#   $1 - Value to check
#   $2 - Variable name (for error message)
validate_positive_integer() {
    local value="$1"
    local var_name="$2"
    
    if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -le 0 ]; then
        die "$var_name must be a positive integer, got: $value" "$EXIT_INVALID_ARGUMENT"
    fi
}

# Run a command with error handling
# Args:
#   $@ - Command and arguments
# Returns: Command exit code, logs on failure
run_or_die() {
    local output
    local exit_code
    
    log_debug "Running: $*"
    
    if output=$("$@" 2>&1); then
        exit_code=0
    else
        exit_code=$?
        log_error "Command failed with exit code $exit_code: $*"
        if [ -n "$output" ]; then
            log_error "Output: $output"
        fi
    fi
    
    return "$exit_code"
}

# Assert a condition is true, exit if false
# Args:
#   $1 - Condition to test (as string that will be eval'd)
#   $2 - Error message if condition is false
assert() {
    local condition="$1"
    local message="$2"
    
    if ! eval "$condition"; then
        die "Assertion failed: $message" "$EXIT_GENERAL_ERROR"
    fi
}

# Print a success message
# Args:
#   $1 - Message
success() {
    local message="$1"
    local color=""
    local reset=""
    
    if use_colors; then
        color="$COLOR_GREEN"
        reset="$COLOR_RESET"
    fi
    
    printf "${color}✓ %s${reset}\n" "$message" >&2
}

# Print a warning message
# Args:
#   $1 - Message  
warn() {
    log_warn "$@"
}

# Print an info message
# Args:
#   $1 - Message
info() {
    log_info "$@"
}

# Create a temporary directory
# Returns: Path to temp directory (via stdout)
# Note: Caller is responsible for cleanup
create_temp_dir() {
    local temp_dir
    temp_dir=$(mktemp -d) || die "Failed to create temporary directory" "$EXIT_GENERAL_ERROR"
    
    log_debug "Created temporary directory: $temp_dir" >&2
    echo "$temp_dir"
}

# Retry a command with exponential backoff
# Args:
#   $1 - Max attempts
#   $2 - Initial delay in seconds
#   $3+ - Command to run
retry_with_backoff() {
    local max_attempts="$1"
    local delay="$2"
    shift 2
    local attempt=1
    
    while [ "$attempt" -le "$max_attempts" ]; do
        log_debug "Attempt $attempt/$max_attempts: $*"
        
        if "$@"; then
            return 0
        fi
        
        if [ "$attempt" -lt "$max_attempts" ]; then
            log_warn "Command failed, retrying in ${delay}s..."
            sleep "$delay"
            delay=$((delay * 2))
        fi
        
        attempt=$((attempt + 1))
    done
    
    log_error "Command failed after $max_attempts attempts: $*"
    return 1
}

# Enable strict error handling mode
# Sets: -e (exit on error), -u (error on undefined vars), -o pipefail (pipe failures)
# Also sets up ERR trap for better error reporting
enable_strict_mode() {
    set -euo pipefail
    ERROR_HANDLING_STRICT_MODE_ENABLED=1
    
    # Set up error trap if not already set
    if ! trap -p ERR | grep -q "on_script_error"; then
        trap 'on_script_error $? ${LINENO} "${BASH_COMMAND}"' ERR
    fi
    
    log_debug "Strict error handling mode enabled"
}

# Default error handler for ERR trap
# Args:
#   $1 - Exit code
#   $2 - Line number
#   $3 - Command that failed
on_script_error() {
    local exit_code="$1"
    local line_number="$2"
    local failed_command="$3"
    
    log_error "Script error at line $line_number: command exited with code $exit_code"
    log_error "Failed command: $failed_command"
    
    # Don't exit if we're in a subshell or function that wants to handle it
    if [ "${BASH_SUBSHELL:-0}" -eq 0 ]; then
        exit "$exit_code"
    fi
}

# Check if strict mode is enabled
# Returns: 0 if enabled, 1 otherwise
is_strict_mode_enabled() {
    [ "$ERROR_HANDLING_STRICT_MODE_ENABLED" -eq 1 ]
}

# Safely remove a file or directory with validation
# Args:
#   $1 - Path to remove
#   $2 - Optional: expected parent directory (for safety)
safe_remove() {
    local path="$1"
    local expected_parent="${2:-}"
    
    # Check if path is empty
    if [ -z "$path" ]; then
        log_error "safe_remove: path is empty, refusing to remove"
        return "$EXIT_INVALID_ARGUMENT"
    fi
    
    # Check if path is just / or ~ or other dangerous patterns
    if [[ "$path" =~ ^(/|~|/home|/usr|/var|/etc)$ ]]; then
        log_error "safe_remove: refusing to remove protected path: $path"
        return "$EXIT_PERMISSION_DENIED"
    fi
    
    # If expected parent is provided, validate path is within it
    if [ -n "$expected_parent" ]; then
        local real_path
        real_path=$(readlink -f "$path" 2>/dev/null || echo "$path")
        local real_parent
        real_parent=$(readlink -f "$expected_parent" 2>/dev/null || echo "$expected_parent")
        
        if [[ "$real_path" != "$real_parent"* ]]; then
            log_error "safe_remove: path '$path' is not within expected parent '$expected_parent'"
            return "$EXIT_PERMISSION_DENIED"
        fi
    fi
    
    # Check if path exists
    if [ ! -e "$path" ]; then
        log_debug "safe_remove: path does not exist: $path"
        return 0
    fi
    
    # Perform removal
    log_debug "Removing: $path"
    rm -rf "$path"
}
