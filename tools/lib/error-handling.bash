#!/usr/bin/env bash
# Centralized error handling and logging library
# Provides standardized error messages, exit codes, and logging utilities

# Guard against multiple sourcing
if [ -n "${_ERROR_HANDLING_LOADED:-}" ]; then
    return 0
fi
_ERROR_HANDLING_LOADED=1

# Exit codes - following standard conventions
#
# Canonical set (the only meanings callers may rely on):
#   0 success | 1 general error | 2 invalid usage/args | 3 duplicate/ambiguous
#   match where exactly one was required | 4 gh/API failure or target not
#   found | 5 multiple candidates where one was required | 124 timeout
#   | 127 command missing | 128 invalid exit
#
# Deprecated aliases (Plan: exit-code contract consolidation) - do NOT use in
# new code; they remain only until the last migrated call site is swept:
#   EXIT_INVALID_ARGUMENT -> use EXIT_MISUSE (usage errors) or
#   EXIT_API_FAILURE (not-found conditions)
#   EXIT_NOT_FOUND        -> use EXIT_API_FAILURE (same value, 4)
#   EXIT_PERMISSION_DENIED -> use EXIT_GENERAL_ERROR
# shellcheck disable=SC2034  # Variables exported for use by sourcing scripts
export EXIT_SUCCESS=0
export EXIT_GENERAL_ERROR=1
export EXIT_MISUSE=2
export EXIT_CONFLICT=3
export EXIT_API_FAILURE=4
export EXIT_AMBIGUOUS=5
export EXIT_TIMEOUT=124
export EXIT_COMMAND_NOT_FOUND=127
export EXIT_INVALID_EXIT=128
# Deprecated aliases - collide with the canonical 3/4/5 meanings; do not use.
export EXIT_INVALID_ARGUMENT=3
export EXIT_NOT_FOUND=4
export EXIT_PERMISSION_DENIED=5

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
        r) [ -r "$file_path" ] || die "$message" "$EXIT_GENERAL_ERROR" ;;
        w) [ -w "$file_path" ] || die "$message" "$EXIT_GENERAL_ERROR" ;;
        x) [ -x "$file_path" ] || die "$message" "$EXIT_GENERAL_ERROR" ;;
        *) die "Invalid permission type: $perm_type" "$EXIT_MISUSE" ;;
    esac
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

# ============================================================================
# Script argument helpers (promoted from the per-script copy-paste tier)
# ============================================================================

# invalid_args MESSAGE
#   Standard invalid-arguments handler: logs MESSAGE as an error, prints the
#   usage hint, and exits 2 (EXIT_MISUSE). Exits — does not return.
#   Canonical exit-code contract: 2 = invalid arguments.
invalid_args() {
    log_error "$1"
    echo "Use --help for usage information"
    exit "$EXIT_MISUSE"
}

# require_option_value OPTION_NAME VALUE
#   Validates that VALUE is non-empty; exits 2 via invalid_args otherwise.
#   Callers must pass "${2:-}" (never a raw "$2") so a missing value reaches
#   this helper as an empty string instead of crashing on set -u.
require_option_value() {
    local option_name="$1"
    local value="${2:-}"
    if [ -z "$value" ]; then
        invalid_args "Missing value for $option_name"
    fi
}

# api_failure MESSAGE
#   API/tool failure handler: logs MESSAGE and exits 4 (EXIT_API_FAILURE).
api_failure() {
    log_error "$1"
    exit 4
}

# handle_global_flag ARG
#   Handles the suite-wide global flags (-h|--help, -v|--version) inside an
#   option-parse loop. Returns 1 when ARG is not a global flag so the loop's
#   remaining arms run; exits otherwise (show_usage / version are provided
#   by the caller via SHOW_USAGE_FN and SCRIPT_VERSION).
#   Usage:
#     if handle_global_flag "$1"; then shift; continue; fi
#   Requires: show_usage() defined and SCRIPT_VERSION set by the caller.
handle_global_flag() {
    case "${1:-}" in
        -h|--help)
            if declare -F show_usage > /dev/null; then show_usage; fi
            exit 0
            ;;
        -v|--version)
            echo "${SCRIPT_VERSION:-unknown}"
            exit 0
            ;;
        *)
            return 1
            ;;
    esac
}

# log_verbose [ARGS...]
#   Prints ARGS via log_info when the caller's VERBOSE flag is 1 (VERBOSE
#   defaults to 0). Silent otherwise. The caller owns the VERBOSE global.
log_verbose() {
    if [ "${VERBOSE:-0}" -eq 1 ]; then
        log_info "$@"
    fi
}

# log_verbose_stderr [ARGS...]
#   Same gating as log_verbose but always writes to stderr — for scripts
#   whose stdout stream is consumed by other tools (e.g. TUI/list scripts).
log_verbose_stderr() {
    if [ "${VERBOSE:-0}" -eq 1 ]; then
        log_info "$@" >&2
    fi
}

# create_temp_file VAR_NAME [PREFIX]
#   Creates a unique temp file (mktemp) and registers it for automatic
#   cleanup at script exit via the shared cleanup trap. Sets VAR_NAME (in
#   the caller's scope) to the file path. Nothing is printed to stdout —
#   printing would move the trap registration into a subshell where it
#   dies with the subshell (the same stdout-vs-global channel trap that
#   body-source F001 hit). Prefix defaults to "devenv-temp".
#   Usage: create_temp_file TMPFILE my-prefix
create_temp_file() {
    local var_name="$1"
    local prefix="${2:-devenv-temp}"
    local tmpfile
    tmpfile=$(mktemp "${TMPDIR:-/tmp}/${prefix}.XXXXXX")
    printf -v "$var_name" '%s' "$tmpfile"
    register_cleanup "rm -f $(printf '%q' "$tmpfile")"
}

# register_cleanup COMMAND
#   Appends COMMAND to the cleanup chain executed when the script exits
#   (success or failure). Commands run in reverse registration order.
#   Uses the caller's EXIT trap slot; multiple registrations accumulate.
register_cleanup() {
    local cmd="$1"
    local existing=""
    # trap -p EXIT emits:  trap -- '<escaped command>' EXIT
    # Extract the single-quoted command; embedded quotes are escaped by bash
    # as '\'' sequences, which round-trip safely when re-passed to trap.
    existing=$(trap -p EXIT | sed -n "s/^trap -- '\(.*\)' EXIT\$/\1/p")
    if [ -n "$existing" ]; then
        trap -- "${cmd}; ${existing}" EXIT
    else
        trap -- "${cmd}" EXIT
    fi
}
