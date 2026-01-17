#!/bin/bash
# SCRIPT_NAME.sh - Brief description of what this script does
# Version: 1.0.0
# Description: Detailed description of the script's purpose and functionality
# Requirements: Bash 4.0+, any other dependencies
# Author: Your Name
# Last Modified: YYYY-MM-DD

# Note: Strict error handling (set -euo pipefail and ERR trap) is configured
# via enable_strict_mode() from error-handling.bash after sourcing libraries

# ============================================================================
# Configuration and Constants
# ============================================================================

readonly SCRIPT_VERSION="1.0.0"
# shellcheck disable=SC2155  # basename is safe and won't fail
readonly SCRIPT_NAME="$(basename "$0")"

# Default configuration values
readonly DEFAULT_TIMEOUT=30
readonly DEFAULT_MAX_RETRIES=3

# ============================================================================
# Source Required Libraries
# ============================================================================

# shellcheck source=../lib/error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"

# shellcheck source=../lib/versioning.bash
source "$DEVENV_TOOLS/lib/versioning.bash"

# Enable strict error handling (sets -euo pipefail and ERR trap)
enable_strict_mode
    
# Display version if requested
script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Brief description"
    
# Check environment compatibility
if ! check_environment_requirements; then
    log_fatal "Environment does not meet minimum requirements"
    exit "$EXIT_GENERAL_ERROR"
fi

# shellcheck source=../lib/retry.bash
source "$DEVENV_TOOLS/lib/retry.bash"

# Optional: source git-config.bash if working with git repos
# shellcheck source=../lib/git-config.bash
# source "$DEVENV_TOOLS/lib/git-config.bash"

# Optional: source github-helpers.bash if working with GitHub
# shellcheck source=../lib/github-helpers.bash
# source "$DEVENV_TOOLS/lib/github-helpers.bash"

# ============================================================================
# Global Variables (avoid if possible, prefer function parameters)
# ============================================================================

# Example variables - remove if not needed
VERBOSE=${VERBOSE:-0}
DRY_RUN=${DRY_RUN:-0}

# ============================================================================
# Helper Functions
# ============================================================================

# Display usage information
# Arguments: None
# Returns: Exits with code 0
show_usage() {
    cat << EOF
Usage: $SCRIPT_NAME [OPTIONS] [ARGUMENTS]

Brief description of what the script does.

Arguments:
    ARG1        Description of first argument
    ARG2        Description of second argument (optional)

Options:
    -h, --help          Show this help message and exit
    -v, --version       Show version information and exit
    -V, --verbose       Enable verbose output
    -n, --dry-run       Show what would be done without doing it
    -o, --option VALUE  Description of this option

Environment Variables:
    VAR_NAME            Description of environment variable
    TIMEOUT             Operation timeout in seconds (default: $DEFAULT_TIMEOUT)
    MAX_RETRIES         Maximum retry attempts (default: $DEFAULT_MAX_RETRIES)

Examples:
    # Basic usage
    $SCRIPT_NAME arg1 arg2

    # With options
    $SCRIPT_NAME --verbose --option value arg1

    # Dry run mode
    $SCRIPT_NAME --dry-run arg1

Exit Codes:
    0   Success
    1   General error
    2   Invalid arguments
    3   Missing dependencies
    4   Operation failed

For more information, see the documentation at:
    $DEVENV_ROOT/docs/

EOF
    exit 0
}

# Optional: Custom error handler if you need additional error handling beyond library default
# Note: enable_strict_mode() already sets up on_script_error() from error-handling.bash
# Only define this if you need custom behavior beyond the standard error handler
# on_error() {
#     local exit_code=$?
#     local line_number=${1:-unknown}
#     local command="${2:-unknown}"
#     
#     log_error "Script failed at line $line_number with exit code $exit_code"
#     log_error "Failed command: $command"
#     
#     # Perform any cleanup needed
#     cleanup
#     
#     exit "$exit_code"
# }

# Cleanup function - called on script exit via trap
# Note: This is optional. Only implement if you need custom cleanup.
# The error-handling.bash library provides safe_remove() for safe file/dir removal.
# Arguments: None
# Returns: None
# Side effects:
#   Removes temporary files and directories
#   Kills background processes if any
cleanup() {
    local exit_code=$?
    
    # Use safe_remove from error-handling.bash for cleanup
    if [ -n "${TEMP_FILE:-}" ]; then
        safe_remove "$TEMP_FILE"
    fi
    
    if [ -n "${TEMP_DIR:-}" ]; then
        safe_remove "$TEMP_DIR"
    fi
    
    # Kill background processes if any
    if [ -n "${BG_PID:-}" ]; then
        if kill -0 "$BG_PID" 2>/dev/null; then
            log_debug "Terminating background process: $BG_PID"
            kill "$BG_PID" 2>/dev/null || true
        fi
    fi
    
    return "$exit_code"
}

# Set up cleanup trap (ERR trap is already set by enable_strict_mode)
trap 'cleanup' EXIT

# Validate script dependencies using error-handling.bash functions
# Note: Use require_command from error-handling.bash for cleaner code
# Arguments: None
# Returns:
#   0 if all dependencies are met
#   Exits with EXIT_COMMAND_NOT_FOUND if dependencies are missing
validate_dependencies() {
    # Use require_command from error-handling.bash
    # It will automatically exit with proper error code if command is missing
    
    # Example: require_command "git"
    # Example: require_command "curl"
    # Example: require_command "jq"
    
    # Or check multiple with custom messages:
    # require_command "git" "Git is required. Install from https://git-scm.com/"
    # require_command "jq" "jq is required for JSON processing. Install from https://stedolan.github.io/jq/"
    
    # For environment variables:
    # require_env "GITHUB_TOKEN" "GITHUB_TOKEN must be set for authentication"
    
    # For files/directories:
    # require_file "/path/to/config"
    # require_directory "/path/to/data"
    
    return 0
}

# Validate input arguments using error-handling.bash functions
# Arguments:
#   $1: arg1 - First argument to validate
#   $2: arg2 - Second argument to validate (optional)
# Returns:
#   0 if validation passes
#   Exits with proper error code if validation fails
validate_arguments() {
    local arg1="${1:-}"
    local arg2="${2:-}"
    
    # Use die() from error-handling.bash for cleaner error handling
    if [ -z "$arg1" ]; then
        die "First argument is required" "$EXIT_INVALID_ARGUMENT"
    fi
    
    # For integer validation, use validate_positive_integer from error-handling.bash
    # Example: validate_positive_integer "$arg1" "timeout"
    
    # For pattern validation:
    # if [[ ! "$arg1" =~ ^[0-9]+$ ]]; then
    #     die "Argument must be a number, got: $arg1" "$EXIT_INVALID_ARGUMENT"
    # fi
    
    # Use require_file/require_directory for path validation:
    # require_file "$arg1"
    # require_directory "$arg2"
    
    return 0
}

# ============================================================================
# Main Script Functions
# ============================================================================

# Example function - replace with your actual functionality
# Arguments:
#   $1: input - Input parameter
# Returns:
#   0 on success, non-zero on failure
# Side effects:
#   Prints results to stdout
process_data() {
    local input="$1"
    
    # Use log_debug/log_info from error-handling.bash
    log_debug "Processing: $input"
    
    # Add your actual logic here
    
    if [ "$DRY_RUN" -eq 1 ]; then
        log_info "[DRY RUN] Would process: $input"
        return 0
    fi
    
    # Actual processing
    success "Processed: $input"
    
    return 0
}

# Another example function with retry logic
# Arguments:
#   $1: source - Source location
#   $2: destination - Destination location
# Returns:
#   0 on success, non-zero on failure
perform_operation() {
    local source="$1"
    local destination="$2"
    
    log_info "Performing operation: $source -> $destination"
    
    # For operations that might fail temporarily, use retry_with_backoff
    # Example: retry_with_backoff 3 2 curl "$source" -o "$destination"
    
    # For critical commands, use run_or_die from error-handling.bash
    # Example: run_or_die cp "$source" "$destination"
    
    # Add your actual logic here
    
    return 0
}

# ============================================================================
# Main Function
# ============================================================================

main() {
    # Parse command line arguments
    local arg1=""
    local arg2=""
    local option_value=""
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                ;;
            -v|--version)
                echo "$SCRIPT_NAME version $SCRIPT_VERSION"
                exit 0
                ;;
            -V|--verbose)
                VERBOSE=1
                shift
                ;;
            -n|--dry-run)
                DRY_RUN=1
                shift
                ;;
            -o|--option)
                if [ -n "${2:-}" ]; then
                    option_value="$2"
                    shift 2
                else
                    die "--option requires a value" "$EXIT_INVALID_ARGUMENT"
                fi
                ;;
            -*-)
                die "Unknown option: $1. Use --help for usage information" "$EXIT_INVALID_ARGUMENT"
                ;;
            *)
                # Positional arguments
                if [ -z "$arg1" ]; then
                    arg1="$1"
                elif [ -z "$arg2" ]; then
                    arg2="$1"
                else
                    die "Too many arguments" "$EXIT_INVALID_ARGUMENT"
                fi
                shift
                ;;
        esac
    done
    
    # Validate dependencies (will exit automatically if missing)
    validate_dependencies
    
    # Validate arguments (will exit automatically if invalid)
    validate_arguments "$arg1" "$arg2"
    
    # Display configuration using logging functions
    log_debug "Configuration:"
    log_debug "  Script: $SCRIPT_NAME v$SCRIPT_VERSION"
    log_debug "  Argument 1: $arg1"
    [ -n "$arg2" ] && log_debug "  Argument 2: $arg2"
    [ -n "$option_value" ] && log_debug "  Option: $option_value"
    log_debug "  Dry Run: $([[ $DRY_RUN -eq 1 ]] && echo 'Yes' || echo 'No')"
    
    # Main script logic
    log_info "Starting $SCRIPT_NAME..."
    
    # Example usage of functions
    process_data "$arg1"
    
    if [ -n "$arg2" ]; then
        perform_operation "$arg1" "$arg2"
    fi
    
    # Use success() from error-handling.bash for consistent output
    success "$SCRIPT_NAME completed successfully"
    
    return 0
}

# ============================================================================
# Script Entry Point
# ============================================================================

# Only run main if executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
