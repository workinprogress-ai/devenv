# Logging Framework

The Devenv project includes a standardized logging framework in `lib/error-handling.bash` that provides consistent logging across all scripts with timestamps, log levels, and proper output streams.

## Features

- **Standardized log levels**: DEBUG, INFO, WARN, ERROR, FATAL
- **Automatic timestamps**: ISO 8601 format with timezone
- **Color-coded output**: Visual distinction between log levels (when terminal supports colors)
- **Proper output streams**: Errors go to stderr, info to stdout
- **Environment-based debug control**: Enable debug logs via `DEBUG` environment variable

## Usage

### Basic Setup

Source the error handling library at the beginning of your script:

```bash
#!/bin/bash

# Source error handling library
if [ -f "$DEVENV_ROOT/lib/error-handling.bash" ]; then
    source "$DEVENV_ROOT/lib/error-handling.bash"
fi

# Enable strict mode (optional but recommended)
enable_strict_mode
```

### Logging Functions

#### log_debug

Logs debug-level messages (only shown when `DEBUG=1` or `DEBUG=true`).

```bash
log_debug "Starting configuration validation"
log_debug "Found ${count} items to process"
```

**Output**: `[2026-01-01T10:30:45-04:00] [DEBUG] Starting configuration validation`

#### log_info

Logs informational messages to stdout.

```bash
log_info "Processing repository: $repo_name"
log_info "Configuration updated successfully"
```

**Output**: `[2026-01-01T10:30:45-04:00] [INFO] Processing repository: my-repo`

#### log_warn

Logs warning messages to stderr (non-fatal issues).

```bash
log_warn "Cache directory not found, creating it"
log_warn "Using default configuration"
```

**Output**: `[2026-01-01T10:30:45-04:00] [WARN] Cache directory not found, creating it`

#### log_error

Logs error messages to stderr (does not exit).

```bash
log_error "Failed to connect to database"
log_error "Invalid configuration file format"
```

**Output**: `[2026-01-01T10:30:45-04:00] [ERROR] Failed to connect to database`

#### log_fatal

Logs fatal error messages to stderr and exits with code 1.

```bash
log_fatal "Cannot proceed without valid credentials"
# Script exits here
```

**Output**: `[2026-01-01T10:30:45-04:00] [FATAL] Cannot proceed without valid credentials`

## Log Levels

| Level | Color | Stream | Exits | Use Case |
|-------|-------|--------|-------|----------|
| DEBUG | Cyan | stdout | No | Detailed troubleshooting information |
| INFO | Green | stdout | No | Normal operational messages |
| WARN | Yellow | stderr | No | Potential issues that don't prevent execution |
| ERROR | Red | stderr | No | Errors that can be handled/recovered from |
| FATAL | Red Bold | stderr | Yes | Unrecoverable errors requiring script termination |

## Environment Variables

### DEBUG

Enable debug logging:

```bash
# Enable debug logs for single command
DEBUG=1 ./scripts/my-script.sh

# Enable debug logs for session
export DEBUG=1
./scripts/my-script.sh
```

## Examples

### Example 1: Script with Logging

```bash
#!/bin/bash

if [ -f "$DEVENV_ROOT/lib/error-handling.bash" ]; then
    source "$DEVENV_ROOT/lib/error-handling.bash"
fi

enable_strict_mode

log_info "Starting backup process"

if [ ! -d "/var/backups" ]; then
    log_warn "Backup directory missing, creating it"
    mkdir -p /var/backups || log_fatal "Cannot create backup directory"
fi

log_debug "Checking for files to backup"
file_count=$(find /data -type f | wc -l)
log_info "Found $file_count files to backup"

if ! tar -czf /var/backups/backup.tar.gz /data; then
    log_error "Backup failed, retrying..."
    sleep 5
    tar -czf /var/backups/backup.tar.gz /data || log_fatal "Backup failed after retry"
fi

log_info "Backup completed successfully"
```

### Example 2: Debug Logging

```bash
#!/bin/bash

source lib/error-handling.bash

process_data() {
    local data="$1"
    
    log_debug "Received data: $data"
    log_debug "Data length: ${#data}"
    
    if [ -z "$data" ]; then
        log_error "Empty data provided"
        return 1
    fi
    
    log_debug "Processing data..."
    # Processing logic here
    log_debug "Processing complete"
    
    return 0
}

log_info "Starting data processor"
process_data "example"
log_info "Data processor finished"
```

Run with debug output:

```bash
DEBUG=1 ./scripts/process-data.sh
```

## Integration with Error Handling

The logging framework integrates seamlessly with the error handling features:

```bash
#!/bin/bash

source lib/error-handling.bash
enable_strict_mode  # Sets up error traps

# Error trap will automatically use log_error
on_script_error() {
    local exit_code=$?
    local line_number=${1:-unknown}
    local command="${2:-unknown}"
    
    log_error "Script failed at line $line_number"
    log_error "Failed command: $command"
    log_error "Exit code: $exit_code"
    
    exit "$exit_code"
}

trap 'on_script_error ${LINENO} "${BASH_COMMAND}"' ERR
```

## Best Practices

1. **Use appropriate log levels**
   - Use `log_debug` for detailed troubleshooting info
   - Use `log_info` for normal operation messages
   - Use `log_warn` for recoverable issues
   - Use `log_error` for failures that can be handled
   - Use `log_fatal` only for unrecoverable errors

2. **Provide context**

   ```bash
   # Good
   log_info "Processing repository: $repo_name ($count files)"
   
   # Less helpful
   log_info "Processing"
   ```

3. **Log before risky operations**

   ```bash
   log_debug "Attempting to remove directory: $dir"
   rm -rf "$dir"
   log_debug "Directory removed successfully"
   ```

4. **Use debug logs liberally**
   - Debug logs don't affect production (only shown when DEBUG=1)
   - Help with troubleshooting when issues occur

5. **Combine with error handling**

   ```bash
   if ! some_command; then
       log_error "Command failed, trying alternative approach"
       alternative_command || log_fatal "Alternative also failed"
   fi
   ```

## Testing

Tests for the logging framework are in `tests/test_error_handling.bats`:

```bash
# Run logging tests
bats tests/test_error_handling.bats

# Run with debug output
DEBUG=1 bats tests/test_error_handling.bats
```

## See Also

- [Error Handling Documentation](../lib/error-handling.bash) - Full error handling library reference
- [Contributing Guide](Contributing.md) - Guidelines for using logging in contributions
- [Coding Standards](Coding-standards.md) - Code quality standards including logging
- [Additional Tooling](Additional-Tooling.md) - Development tools and utilities
