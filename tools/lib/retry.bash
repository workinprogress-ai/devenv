#!/bin/bash
# retry.bash - Retry mechanism library for network operations
# Version: 1.0.0
# Description: Provides retry logic with exponential backoff for resilient operations

# Prevent multiple sourcing
if [ -n "${RETRY_LIB_LOADED:-}" ]; then
    return 0
fi
readonly RETRY_LIB_LOADED=1

# Default configuration
readonly DEFAULT_MAX_RETRIES=3
readonly DEFAULT_INITIAL_DELAY=1
readonly DEFAULT_MAX_DELAY=60
readonly DEFAULT_BACKOFF_MULTIPLIER=2
readonly DEFAULT_TIMEOUT=300

# Retry with exponential backoff
# Arguments:
#   $1: max_attempts - Maximum number of retry attempts
#   $2..$N: command - Command to execute with its arguments
# Returns:
#   Exit code of the command if successful
#   1 if all retries exhausted
# Environment:
#   RETRY_INITIAL_DELAY - Initial delay in seconds (default: 1)
#   RETRY_MAX_DELAY - Maximum delay in seconds (default: 60)
#   RETRY_BACKOFF_MULTIPLIER - Backoff multiplier (default: 2)
# Example:
#   retry_with_exponential_backoff 5 curl -f https://example.com
retry_with_exponential_backoff() {
    local max_attempts="$1"
    shift
    local command=("$@")
    
    local attempt=1
    local delay="${RETRY_INITIAL_DELAY:-$DEFAULT_INITIAL_DELAY}"
    local max_delay="${RETRY_MAX_DELAY:-$DEFAULT_MAX_DELAY}"
    local multiplier="${RETRY_BACKOFF_MULTIPLIER:-$DEFAULT_BACKOFF_MULTIPLIER}"
    
    while [ "$attempt" -le "$max_attempts" ]; do
        echo "Attempt $attempt/$max_attempts: ${command[*]}" >&2
        
        if "${command[@]}"; then
            echo "✓ Command succeeded on attempt $attempt" >&2
            return 0
        fi
        
        local exit_code=$?
        
        if [ "$attempt" -eq "$max_attempts" ]; then
            echo "✗ All $max_attempts attempts failed" >&2
            return "$exit_code"
        fi
        
        echo "✗ Attempt $attempt failed (exit code: $exit_code). Retrying in ${delay}s..." >&2
        sleep "$delay"
        
        # Calculate next delay with exponential backoff
        delay=$((delay * multiplier))
        if [ "$delay" -gt "$max_delay" ]; then
            delay="$max_delay"
        fi
        
        ((attempt++))
    done
    
    return 1
}

# Retry with linear backoff
# Arguments:
#   $1: max_attempts - Maximum number of retry attempts
#   $2: delay_seconds - Fixed delay between retries
#   $3..$N: command - Command to execute with its arguments
# Returns:
#   Exit code of the command if successful
#   1 if all retries exhausted
# Example:
#   retry_with_linear_backoff 3 5 git fetch origin
retry_with_linear_backoff() {
    local max_attempts="$1"
    local delay="$2"
    shift 2
    local command=("$@")
    
    local attempt=1
    
    while [ "$attempt" -le "$max_attempts" ]; do
        echo "Attempt $attempt/$max_attempts: ${command[*]}" >&2
        
        if "${command[@]}"; then
            echo "✓ Command succeeded on attempt $attempt" >&2
            return 0
        fi
        
        local exit_code=$?
        
        if [ "$attempt" -eq "$max_attempts" ]; then
            echo "✗ All $max_attempts attempts failed" >&2
            return "$exit_code"
        fi
        
        echo "✗ Attempt $attempt failed (exit code: $exit_code). Retrying in ${delay}s..." >&2
        sleep "$delay"
        
        ((attempt++))
    done
    
    return 1
}

# Retry with timeout
# Arguments:
#   $1: timeout_seconds - Maximum time to wait for command completion
#   $2: max_attempts - Maximum number of retry attempts
#   $3..$N: command - Command to execute with its arguments
# Returns:
#   Exit code of the command if successful
#   124 if timeout occurred
#   1 if all retries exhausted
# Example:
#   retry_with_timeout 30 3 wget https://example.com/large-file.zip
retry_with_timeout() {
    local timeout_seconds="$1"
    local max_attempts="$2"
    shift 2
    local command=("$@")
    
    local attempt=1
    local delay="${RETRY_INITIAL_DELAY:-$DEFAULT_INITIAL_DELAY}"
    local max_delay="${RETRY_MAX_DELAY:-$DEFAULT_MAX_DELAY}"
    local multiplier="${RETRY_BACKOFF_MULTIPLIER:-$DEFAULT_BACKOFF_MULTIPLIER}"
    
    while [ "$attempt" -le "$max_attempts" ]; do
        echo "Attempt $attempt/$max_attempts (timeout: ${timeout_seconds}s): ${command[*]}" >&2
        
        if timeout "$timeout_seconds" "${command[@]}"; then
            echo "✓ Command succeeded on attempt $attempt" >&2
            return 0
        fi
        
        local exit_code=$?
        
        if [ "$exit_code" -eq 124 ]; then
            echo "✗ Attempt $attempt timed out after ${timeout_seconds}s" >&2
        else
            echo "✗ Attempt $attempt failed (exit code: $exit_code)" >&2
        fi
        
        if [ "$attempt" -eq "$max_attempts" ]; then
            echo "✗ All $max_attempts attempts failed" >&2
            return "$exit_code"
        fi
        
        echo "Retrying in ${delay}s..." >&2
        sleep "$delay"
        
        # Calculate next delay with exponential backoff
        delay=$((delay * multiplier))
        if [ "$delay" -gt "$max_delay" ]; then
            delay="$max_delay"
        fi
        
        ((attempt++))
    done
    
    return 1
}

# Retry URL fetch operations (curl/wget)
# Arguments:
#   $1: url - URL to fetch
#   $2: output_file - Optional output file path
# Returns:
#   0 if successful, non-zero otherwise
# Environment:
#   RETRY_MAX_ATTEMPTS - Maximum retry attempts (default: 3)
#   RETRY_TIMEOUT - Timeout per attempt in seconds (default: 300)
# Example:
#   retry_url_fetch "https://example.com/file" "/tmp/output"
retry_url_fetch() {
    local url="$1"
    local output_file="${2:-}"
    local max_attempts="${RETRY_MAX_ATTEMPTS:-$DEFAULT_MAX_RETRIES}"
    local timeout="${RETRY_TIMEOUT:-$DEFAULT_TIMEOUT}"
    
    local fetch_cmd
    if command -v curl &> /dev/null; then
        if [ -n "$output_file" ]; then
            fetch_cmd=(curl -fL --max-time "$timeout" -o "$output_file" "$url")
        else
            fetch_cmd=(curl -fL --max-time "$timeout" "$url")
        fi
    elif command -v wget &> /dev/null; then
        if [ -n "$output_file" ]; then
            fetch_cmd=(wget -T "$timeout" -O "$output_file" "$url")
        else
            fetch_cmd=(wget -T "$timeout" -O - "$url")
        fi
    else
        echo "ERROR: Neither curl nor wget found" >&2
        return 1
    fi
    
    retry_with_exponential_backoff "$max_attempts" "${fetch_cmd[@]}"
}

# Retry git clone operation
# Arguments:
#   $1: repository_url - Git repository URL
#   $2: destination - Destination directory
#   $3..$N: additional_args - Additional git clone arguments
# Returns:
#   0 if successful, non-zero otherwise
# Environment:
#   RETRY_MAX_ATTEMPTS - Maximum retry attempts (default: 3)
# Example:
#   retry_git_clone "https://github.com/user/repo.git" "./repo" --depth 1
retry_git_clone() {
    local repo_url="$1"
    local destination="$2"
    shift 2
    local additional_args=("$@")
    local max_attempts="${RETRY_MAX_ATTEMPTS:-$DEFAULT_MAX_RETRIES}"
    
    local attempt=1
    local delay="${RETRY_INITIAL_DELAY:-$DEFAULT_INITIAL_DELAY}"
    local max_delay="${RETRY_MAX_DELAY:-$DEFAULT_MAX_DELAY}"
    local multiplier="${RETRY_BACKOFF_MULTIPLIER:-$DEFAULT_BACKOFF_MULTIPLIER}"
    
    while [ "$attempt" -le "$max_attempts" ]; do
        echo "Attempt $attempt/$max_attempts: git clone $repo_url $destination" >&2
        
        if git clone "$repo_url" "$destination" "${additional_args[@]}"; then
            echo "✓ Git clone succeeded on attempt $attempt" >&2
            return 0
        fi
        
        local exit_code=$?
        
        # Cleanup failed attempt
        if [ -d "$destination" ]; then
            echo "Cleaning up failed clone directory: $destination" >&2
            rm -rf "$destination"
        fi
        
        if [ "$attempt" -eq "$max_attempts" ]; then
            echo "✗ All $max_attempts clone attempts failed" >&2
            return "$exit_code"
        fi
        
        echo "✗ Clone attempt $attempt failed (exit code: $exit_code). Retrying in ${delay}s..." >&2
        sleep "$delay"
        
        delay=$((delay * multiplier))
        if [ "$delay" -gt "$max_delay" ]; then
            delay="$max_delay"
        fi
        
        ((attempt++))
    done
    
    return 1
}

# Retry git fetch operation
# Arguments:
#   $1..$N: git_fetch_args - Arguments to pass to git fetch
# Returns:
#   0 if successful, non-zero otherwise
# Environment:
#   RETRY_MAX_ATTEMPTS - Maximum retry attempts (default: 3)
# Example:
#   retry_git_fetch --all --tags -f
retry_git_fetch() {
    local max_attempts="${RETRY_MAX_ATTEMPTS:-$DEFAULT_MAX_RETRIES}"
    retry_with_exponential_backoff "$max_attempts" git fetch "$@"
}

# Check if operation should be retried based on exit code
# Arguments:
#   $1: exit_code - Exit code to check
# Returns:
#   0 if should retry, 1 if should not retry
# Example:
#   if should_retry $exit_code; then
#       echo "Will retry"
#   fi
should_retry() {
    local exit_code="$1"
    
    # Don't retry on these exit codes
    case $exit_code in
        0)   return 1 ;;  # Success
        127) return 1 ;;  # Command not found
        126) return 1 ;;  # Command not executable
        130) return 1 ;;  # SIGINT (Ctrl+C)
        137) return 1 ;;  # SIGKILL
        *)   return 0 ;;  # Retry on all other codes
    esac
}

# Retry with custom retry logic
# Arguments:
#   $1: max_attempts - Maximum number of retry attempts
#   $2: should_retry_fn - Function to call to determine if should retry
#   $3..$N: command - Command to execute with its arguments
# Returns:
#   Exit code of the command if successful
#   1 if all retries exhausted
# Example:
#   my_retry_logic() { [ $1 -ne 0 ] && [ $1 -ne 127 ]; }
#   retry_with_custom_logic 5 my_retry_logic curl https://example.com
retry_with_custom_logic() {
    local max_attempts="$1"
    local should_retry_fn="$2"
    shift 2
    local command=("$@")
    
    local attempt=1
    local delay="${RETRY_INITIAL_DELAY:-$DEFAULT_INITIAL_DELAY}"
    local max_delay="${RETRY_MAX_DELAY:-$DEFAULT_MAX_DELAY}"
    local multiplier="${RETRY_BACKOFF_MULTIPLIER:-$DEFAULT_BACKOFF_MULTIPLIER}"
    
    while [ "$attempt" -le "$max_attempts" ]; do
        echo "Attempt $attempt/$max_attempts: ${command[*]}" >&2
        
        if "${command[@]}"; then
            echo "✓ Command succeeded on attempt $attempt" >&2
            return 0
        fi
        
        local exit_code=$?
        
        # Check if we should retry
        if ! "$should_retry_fn" "$exit_code"; then
            echo "✗ Command failed with non-retriable exit code: $exit_code" >&2
            return "$exit_code"
        fi
        
        if [ "$attempt" -eq "$max_attempts" ]; then
            echo "✗ All $max_attempts attempts failed" >&2
            return "$exit_code"
        fi
        
        echo "✗ Attempt $attempt failed (exit code: $exit_code). Retrying in ${delay}s..." >&2
        sleep "$delay"
        
        delay=$((delay * multiplier))
        if [ "$delay" -gt "$max_delay" ]; then
            delay="$max_delay"
        fi
        
        ((attempt++))
    done
    
    return 1
}

# Export functions for use in subshells
export -f retry_with_exponential_backoff
export -f retry_with_linear_backoff
export -f retry_with_timeout
export -f retry_url_fetch
export -f retry_git_clone
export -f retry_git_fetch
export -f should_retry
export -f retry_with_custom_logic
