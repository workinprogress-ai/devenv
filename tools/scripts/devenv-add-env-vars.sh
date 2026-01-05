#!/bin/bash

# Add or update environment variables in .runtime/env-vars.sh
# Usage: devenv-add-env-vars.sh "VAR1=value1" "VAR2=value2" ...

set -euo pipefail

# shellcheck source=../lib/error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"

# Ensure .runtime directory exists
mkdir -p "$DEVENV_ROOT/.runtime"

ENV_VARS_FILE="$DEVENV_ROOT/.runtime/env-vars.sh"

# Check if at least one environment variable is provided
if [ $# -eq 0 ]; then
    die "Usage: devenv-add-env-vars.sh \"VAR1=value1\" \"VAR2=value2\" ..." "$EXIT_INVALID_ARGUMENT"
fi

# Validate env-vars.sh exists
if [ ! -f "$ENV_VARS_FILE" ]; then
    die "Environment variables file not found: $ENV_VARS_FILE" "$EXIT_GENERAL_ERROR"
fi

# Process each environment variable
added_count=0
updated_count=0

for env_var in "$@"; do
    # Validate format (VAR=value)
    if [[ ! "$env_var" =~ ^[A-Z_][A-Z0-9_]*=.* ]]; then
        log_error "Invalid environment variable format: $env_var"
        log_error "Expected format: VAR_NAME=value (variable name must start with letter/underscore, uppercase)"
        exit $EXIT_INVALID_ARGUMENT
    fi
    
    # Extract variable name and value
    var_name="${env_var%%=*}"
    var_value="${env_var#*=}"
    
    # Check if variable already exists in the file
    if grep -q "^export ${var_name}=" "$ENV_VARS_FILE"; then
        log_info "Updating existing variable: $var_name"
        # Remove the existing line(s) with this variable
        sed -i "/^export ${var_name}=/d" "$ENV_VARS_FILE"
        updated_count=$((updated_count + 1))
    else
        log_info "Adding new variable: $var_name"
        added_count=$((added_count + 1))
    fi
    
    # Add the new export line
    echo "export ${var_name}=${var_value}" >> "$ENV_VARS_FILE"
done

if [ $updated_count -gt 0 ] && [ $added_count -gt 0 ]; then
    success "Added $added_count and updated $updated_count environment variable(s) in $ENV_VARS_FILE"
elif [ $updated_count -gt 0 ]; then
    success "Updated $updated_count environment variable(s) in $ENV_VARS_FILE"
else
    success "Added $added_count environment variable(s) to $ENV_VARS_FILE"
fi

log_info "Environment variables file: $ENV_VARS_FILE"
log_info "Restart your container or source the file to apply changes"
