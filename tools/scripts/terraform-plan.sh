#!/usr/bin/env bash
# Wrapper to run Terraform plan with sensible defaults and DigitalOcean token wiring

set -euo pipefail

# shellcheck source=lib/error-handling.bash
source "$DEVENV_TOOLS/lib/error-handling.bash"

usage() {
    cat <<'EOF'
Usage: terraform-plan.sh [path] [-- additional terraform args]

Runs `terraform init` (if needed) and `terraform plan` in the given path (default: current directory).
If DIGITALOCEAN_API_TOKEN is set, it will be exported as TF_VAR_digitalocean_token for modules that expect it.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi

require_command terraform "terraform is required"

TF_DIR="${1:-.}"
if [ "${1:-}" != "" ] && [ "${1:-}" != "--" ]; then
    shift
fi

# Allow `--` to pass through extra args
if [ "${1:-}" = "--" ]; then
    shift
fi

EXTRA_ARGS=("$@")

if [ ! -d "$TF_DIR" ]; then
    die "Directory not found: $TF_DIR" "$EXIT_NOT_FOUND"
fi

pushd "$TF_DIR" >/dev/null

if [ -n "${DIGITALOCEAN_API_TOKEN:-}" ]; then
    export TF_VAR_digitalocean_token="$DIGITALOCEAN_API_TOKEN"
    log_info "Exported TF_VAR_digitalocean_token from DIGITALOCEAN_API_TOKEN"
fi

if [ ! -d .terraform ]; then
    log_info "Running terraform init"
    terraform init
fi

log_info "Running terraform plan ${EXTRA_ARGS[*]:-}"
terraform plan "${EXTRA_ARGS[@]}"

popd >/dev/null
success "Terraform plan completed"
