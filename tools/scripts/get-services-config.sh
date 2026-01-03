#!/bin/bash

# Clone a configuration repository and extract its contents for local use
# Usage: get-services-config.sh [repo-url] [branch]
# If repo-url is omitted, uses SERVICES_CONFIG_REPO environment variable

set -euo pipefail

# shellcheck source=lib/error-handling.bash
source "$DEVENV_ROOT/tools/lib/error-handling.bash"

repo_url="${1:-${SERVICES_CONFIG_REPO:-}}"
branch="${2:-}"
target_folder="${CONFIG_FOLDER:-$DEVENV_ROOT/.debug/config}"

if [ -z "$repo_url" ]; then
    log_error "No repository URL provided. Set SERVICES_CONFIG_REPO or pass repo-url as argument."
    echo "Usage: get-services-config.sh [repo-url] [branch]"
    exit $EXIT_INVALID_ARGUMENT
fi

return_to_folder=$(pwd)
if [[ "$(pwd)" == "$target_folder" ]]; then
    cd .. >/dev/null
fi

if [[ -d "$target_folder" ]]; then
    log_info "Removing existing config folder: $target_folder"
    rm -rf "$target_folder"
fi

mkdir -p "$target_folder"

log_info "Cloning config repository: $repo_url"
if ! git clone "$repo_url" "$target_folder"; then
    die "Failed to clone config repository from: $repo_url" "$EXIT_GENERAL_ERROR"
fi


if [ -n "$branch" ]; then
    log_info "Checking out branch: $branch"
    cd "$target_folder"
    git checkout "$branch"
    cd - >/dev/null
fi

# Remove git and build artifacts
log_info "Cleaning up artifacts"
rm -rf "$target_folder/.git"
rm -rf "$target_folder/.gitignore"
rm -rf "$target_folder/.husky"
rm -rf "$target_folder/.repo"
rm -rf "$target_folder/.vscode"
rm -rf "$target_folder/node_modules"
rm -rf "$target_folder/scripts"

# Create info file with metadata
{
    echo "# Configuration extracted: $(date)"
    echo "# Repository: $repo_url"
    [ -n "$branch" ] && echo "# Branch: $branch"
} > "$target_folder/info.txt"

# Create template for environment overrides if not present
if [ ! -f "$target_folder/default.env" ]; then
    cat > "$target_folder/default.env" <<'EOF'
# Local environment overrides for services configuration
DICTIONARY_SERVER=localhost:6379
DOCUMENT_SERVER=mongodb://localhost
MESSAGE_BROKER_SERVER=nats://localhost:4222
EOF
fi

success "Services config refreshed from: $repo_url"
log_info "Config location: $target_folder"
log_info "Environment overrides template: $target_folder/default.env"

cd "$return_to_folder" 2>/dev/null || true
