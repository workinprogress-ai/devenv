#!/bin/bash

# Add custom startup commands to .devcontainer/custom_startup.sh
# These commands will be executed after the container starts
# Usage: devenv-add-custom-startup.sh "command1" "command2" ...

set -euo pipefail

# shellcheck source=../lib/error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"

STARTUP_SCRIPT="$DEVENV_ROOT/.devcontainer/custom_startup.sh"

# Check if at least one command is provided
if [ $# -eq 0 ]; then
    die "Usage: devenv-add-custom-startup.sh \"command1\" \"command2\" ..." "$EXIT_INVALID_ARGUMENT"
fi

# Create the startup script if it doesn't exist
if [ ! -f "$STARTUP_SCRIPT" ]; then
    log_info "Creating $STARTUP_SCRIPT"
    {
        echo "#!/bin/bash"
        echo ""
        echo "# Custom startup commands"
        echo "# Add commands here that should run after the container starts"
        echo "# This file is auto-generated and can be safely edited"
        echo ""
        echo "set -euo pipefail"
        echo ""
    } > "$STARTUP_SCRIPT"
    chmod 755 "$STARTUP_SCRIPT"
    log_info "Created $STARTUP_SCRIPT with executable permissions"
fi

# Add each command after syntax checking
added_count=0
for cmd in "$@"; do
    # Check syntax by running bash -n on the command
    if bash -n -c "$cmd" 2>/dev/null; then
        # Command has valid bash syntax, add it
        log_info "Adding command: $cmd"
        echo "" >> "$STARTUP_SCRIPT"
        echo "# Added by devenv-add-custom-startup.sh" >> "$STARTUP_SCRIPT"
        echo "$cmd" >> "$STARTUP_SCRIPT"
        ((added_count++))
    else
        # Syntax error in command
        log_error "Syntax error in command: $cmd"
        log_error "Command was NOT added to $STARTUP_SCRIPT"
        exit $EXIT_GENERAL_ERROR
    fi
done

success "Added $added_count custom startup command(s) to $STARTUP_SCRIPT"
log_info "Custom startup script location: $STARTUP_SCRIPT"
