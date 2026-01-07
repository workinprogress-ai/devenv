#!/bin/bash

# Add custom bootstrap commands to .devcontainer/user-custom-bootstrap.sh
# These commands run each time the container is recreated or bootstrap executes
# Usage: devenv-add-custom-bootstrap.sh "command1" "command2" ...

set -euo pipefail

# Resolve locations
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${DEVENV_ROOT:=$(cd "$SCRIPT_DIR/.." && pwd)}"

# shellcheck source=../lib/error-handling.bash
source "$SCRIPT_DIR/../lib/error-handling.bash"

BOOTSTRAP_DIR="$DEVENV_ROOT/.devcontainer"
BOOTSTRAP_SCRIPT="$BOOTSTRAP_DIR/user-custom-bootstrap.sh"

# Require at least one command
if [ $# -eq 0 ]; then
    die "Usage: devenv-add-custom-bootstrap.sh \"command1\" \"command2\" ..." "$EXIT_INVALID_ARGUMENT"
fi

# Ensure target directory and bootstrap script exist with header
mkdir -p "$BOOTSTRAP_DIR"
if [ ! -f "$BOOTSTRAP_SCRIPT" ]; then
    log_info "Creating $BOOTSTRAP_SCRIPT"
    {
        echo "#!/bin/bash"
        echo ""
        echo "# Custom bootstrap commands"
        echo "# Add commands here that should run during bootstrap"
        echo "# This file is auto-generated and can be safely edited"
        echo ""
        echo "set -euo pipefail"
        echo ""
    } > "$BOOTSTRAP_SCRIPT"
    chmod 755 "$BOOTSTRAP_SCRIPT"
    log_info "Created $BOOTSTRAP_SCRIPT with executable permissions"
fi

added_count=0
for cmd in "$@"; do
    if bash -n -c "$cmd" 2>/dev/null; then
        log_info "Adding command: $cmd"
        echo "" >> "$BOOTSTRAP_SCRIPT"
        echo "# Added by devenv-add-custom-bootstrap.sh" >> "$BOOTSTRAP_SCRIPT"
        echo "$cmd" >> "$BOOTSTRAP_SCRIPT"
        added_count=$((added_count + 1))
    else
        log_error "Syntax error in command: $cmd"
        log_error "Command was NOT added to $BOOTSTRAP_SCRIPT"
        exit $EXIT_GENERAL_ERROR
    fi
done

success "Added $added_count custom bootstrap command(s) to $BOOTSTRAP_SCRIPT"
log_info "Custom bootstrap script location: $BOOTSTRAP_SCRIPT"
