#!/usr/bin/env bash
# Leveled logging for the bash bootstrap chain (provider-core.bash and the
# provider modules call log_debug/log_info/log_warn/log_error). Everything goes
# to stderr. Other scripts do not source this file: tools are TypeScript and use
# tools/lib/core/logging.ts.

# Guard against multiple sourcing
if [ -n "${_ERROR_HANDLING_LOADED:-}" ]; then
    return 0
fi
_ERROR_HANDLING_LOADED=1

# Log levels
readonly LOG_LEVEL_DEBUG=0
readonly LOG_LEVEL_INFO=1
readonly LOG_LEVEL_WARN=2
readonly LOG_LEVEL_ERROR=3

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
#   $1 - Log level (DEBUG, INFO, WARN, ERROR)
#   $2+ - Message
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
