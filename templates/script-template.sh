#!/bin/bash
# SCRIPT_NAME.sh - Brief description of what this script does
# Version: 1.0.0
# Description: Detailed description of the script's purpose and functionality
# Requirements: Bash 4.0+, any other dependencies
# Author: Your Name
# Last Modified: YYYY-MM-DD

# Exit immediately if a command exits with a non-zero status
# Treat unset variables as an error
# Fail on pipe errors
set -euo pipefail

# ============================================================================
# Configuration and Constants
# ============================================================================

readonly SCRIPT_VERSION="1.0.0"
readonly SCRIPT_NAME="$(basename "$0")"

# Get script directory and project root
readonly SCRIPT_PATH=$(readlink -f "$0")
readonly SCRIPT_DIR=$(dirname "$SCRIPT_PATH")
readonly PROJECT_ROOT=$(dirname "$SCRIPT_DIR")

# Default configuration values
readonly DEFAULT_TIMEOUT=30
readonly DEFAULT_MAX_RETRIES=3

# ============================================================================
# Source Required Libraries
# ============================================================================

# Source error handling library if available
if [ -f "$PROJECT_ROOT/lib/error-handling.bash" ]; then
    # shellcheck source=../lib/error-handling.bash
    source "$PROJECT_ROOT/lib/error-handling.bash"
fi

# Source versioning library if available
if [ -f "$PROJECT_ROOT/lib/versioning.bash" ]; then
    # shellcheck source=../lib/versioning.bash
    source "$PROJECT_ROOT/lib/versioning.bash"
    
    # Display version if requested
    script_version "$SCRIPT_NAME" "$SCRIPT_VERSION" "Brief description"
    
    # Check environment compatibility
    if ! check_environment_requirements; then
        echo "ERROR: Environment does not meet minimum requirements" >&2
        exit 1
    fi
fi

# Source retry library if available
if [ -f "$PROJECT_ROOT/lib/retry.bash" ]; then
    # shellcheck source=../lib/retry.bash
    source "$PROJECT_ROOT/lib/retry.bash"
fi

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
    $PROJECT_ROOT/docs/

EOF
    exit 0
}

# Error handler function for script failures
# Called automatically via ERR trap when any command fails
# Arguments:
#   $1: line_number - Line number where error occurred (from LINENO)
#   $2: command - Command that failed (from BASH_COMMAND)
# Returns:
#   Exits with the original command's exit code
on_error() {
    local exit_code=$?
    local line_number=${1:-unknown}
    local command="${2:-unknown}"
    
    echo "ERROR: Script failed at line $line_number with exit code $exit_code" >&2
    echo "Failed command: $command" >&2
    
    # Perform any cleanup needed
    cleanup
    
    exit "$exit_code"
}

# Cleanup function - called on script exit
# Arguments: None
# Returns: None
# Side effects:
#   Removes temporary files and directories
#   Kills background processes if any
cleanup() {
    local exit_code=$?
    
    # Remove temporary files if they exist
    if [ -n "${TEMP_FILE:-}" ] && [ -f "$TEMP_FILE" ]; then
        echo "Cleaning up temporary file: $TEMP_FILE" >&2
        rm -f "$TEMP_FILE"
    fi
    
    if [ -n "${TEMP_DIR:-}" ] && [ -d "$TEMP_DIR" ]; then
        echo "Cleaning up temporary directory: $TEMP_DIR" >&2
        rm -rf "$TEMP_DIR"
    fi
    
    # Kill background processes if any
    if [ -n "${BG_PID:-}" ]; then
        if kill -0 "$BG_PID" 2>/dev/null; then
            echo "Terminating background process: $BG_PID" >&2
            kill "$BG_PID" 2>/dev/null || true
        fi
    fi
    
    return "$exit_code"
}

# Set up error handling traps
trap 'on_error ${LINENO} "${BASH_COMMAND}"' ERR
trap 'cleanup' EXIT

# Validate script dependencies
# Arguments: None
# Returns:
#   0 if all dependencies are met
#   3 if dependencies are missing
validate_dependencies() {
    local missing_deps=()
    
    # Check for required commands
    local required_commands=(
        # Add required commands here, e.g.:
        # "git"
        # "curl"
        # "jq"
    )
    
    for cmd in "${required_commands[@]}"; do
        if ! command -v "$cmd" &> /dev/null; then
            missing_deps+=("$cmd")
        fi
    done
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        echo "ERROR: Missing required dependencies: ${missing_deps[*]}" >&2
        echo "Please install the missing dependencies and try again." >&2
        return 3
    fi
    
    return 0
}

# Validate input arguments
# Arguments:
#   $1: arg1 - First argument to validate
#   $2: arg2 - Second argument to validate (optional)
# Returns:
#   0 if validation passes
#   2 if validation fails
validate_arguments() {
    local arg1="${1:-}"
    local arg2="${2:-}"
    
    # Example validation - customize as needed
    if [ -z "$arg1" ]; then
        echo "ERROR: First argument is required" >&2
        return 2
    fi
    
    # Add more validation as needed
    # if [[ ! "$arg1" =~ ^[0-9]+$ ]]; then
    #     echo "ERROR: Argument must be a number" >&2
    #     return 2
    # fi
    
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
    
    if [ "$VERBOSE" -eq 1 ]; then
        echo "Processing: $input" >&2
    fi
    
    # Add your actual logic here
    
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "[DRY RUN] Would process: $input"
        return 0
    fi
    
    # Actual processing
    echo "Processed: $input"
    
    return 0
}

# Another example function
# Arguments:
#   $1: source - Source location
#   $2: destination - Destination location
# Returns:
#   0 on success, non-zero on failure
perform_operation() {
    local source="$1"
    local destination="$2"
    
    if [ "$VERBOSE" -eq 1 ]; then
        echo "Performing operation: $source -> $destination" >&2
    fi
    
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
                    echo "ERROR: --option requires a value" >&2
                    exit 2
                fi
                ;;
            -*)
                echo "ERROR: Unknown option: $1" >&2
                echo "Use --help for usage information" >&2
                exit 2
                ;;
            *)
                # Positional arguments
                if [ -z "$arg1" ]; then
                    arg1="$1"
                elif [ -z "$arg2" ]; then
                    arg2="$1"
                else
                    echo "ERROR: Too many arguments" >&2
                    exit 2
                fi
                shift
                ;;
        esac
    done
    
    # Validate dependencies
    validate_dependencies || exit 3
    
    # Validate arguments
    validate_arguments "$arg1" "$arg2" || exit 2
    
    # Display configuration if verbose
    if [ "$VERBOSE" -eq 1 ]; then
        echo "Configuration:" >&2
        echo "  Script: $SCRIPT_NAME v$SCRIPT_VERSION" >&2
        echo "  Argument 1: $arg1" >&2
        [ -n "$arg2" ] && echo "  Argument 2: $arg2" >&2
        [ -n "$option_value" ] && echo "  Option: $option_value" >&2
        echo "  Verbose: Yes" >&2
        echo "  Dry Run: $([[ $DRY_RUN -eq 1 ]] && echo 'Yes' || echo 'No')" >&2
        echo "" >&2
    fi
    
    # Main script logic
    echo "Starting $SCRIPT_NAME..." >&2
    
    # Example usage of functions
    process_data "$arg1"
    
    if [ -n "$arg2" ]; then
        perform_operation "$arg1" "$arg2"
    fi
    
    echo "✓ $SCRIPT_NAME completed successfully" >&2
    
    return 0
}

# ============================================================================
# Script Entry Point
# ============================================================================

# Only run main if executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
