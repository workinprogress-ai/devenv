#!/bin/bash

_DEVENV_SELF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# tool-versions.bash - Standardized tool and version management for devenv
# Sources this file to ensure consistent tool versions across the environment
# Version: 1.0.0
# Author: WorkInProgress.ai

# This script should be sourced in .bashrc and bootstrap.sh to ensure
# consistent Node.js and npm/pnpm versions across all environments.

# ============================================================================
# Node.js and NPM/PNPM Versions
# ============================================================================

# Node.js version (LTS "Jod" line, matches the dev container image)
# Update this when upgrading Node.js across the team
export NODE_VERSION="24.18.0"

# NPM version (ships with Node.js)
export NPM_VERSION="11.16.0"

# PNPM version - our standardized package manager
# IMPORTANT: Keep this synchronized across all environments
# 11.9.0 is the version baked into the dev container image; repos migrate
# their lockfiles forward to this generation via .repo/update.sh.
export PNPM_VERSION="11.9.0"

# ============================================================================
# Runtime-fetched tool versions
# ============================================================================
# Everything bootstrap downloads or installs by version is declared here, so a
# version bump is one edit in one file (and reviewable as such), never a hunt
# through install scripts.

# yq (YAML processor), a GitHub release tag. Pinned instead of resolving the
# latest release at install time, so every container gets the same binary.
export YQ_VERSION="v4.54.1"

# nvm installer tag (nvm-sh/nvm)
export NVM_VERSION="v0.39.5"

# turbo (npm package version)
export TURBO_VERSION="2.0.6"

# .NET SDK channels installed side by side (space-separated, passed to
# dotnet-install.sh one at a time)
export DOTNET_CHANNELS="8.0 9.0"

# Kubernetes apt repository track (pkgs.k8s.io minor release line); this
# decides which kubectl minor version apt offers
export K8S_APT_TRACK="v1.31"

# ============================================================================
# Download verification pins (sha256)
# ============================================================================
# Downloads of deterministic artifacts (a versioned URL whose content does not
# change) are verified against these digests before they are used; a mismatch
# aborts the install (see download_verified in bootstrap.bash). Bumping a
# version above means re-deriving its digest below in the same edit. Each pin
# records where its digest came from.

# yq ${YQ_VERSION} linux binaries. Source: the release's own `checksums` file
# (https://github.com/mikefarah/yq/releases/download/v4.54.1/checksums, the
# SHA-256 column per `checksums_hashes_order`); also equal to the hash of the
# downloaded binaries.
export YQ_SHA256_AMD64="8e34fc298390875de416e6a4afcb8cabeceb25d9aa8506c1a2f9353cf702ea5f"
export YQ_SHA256_ARM64="189088da0c6429ec5178dfaab1a114805f6cab0b61b165ab236efedf1d57a71b"

# nvm ${NVM_VERSION} install.sh. nvm publishes no checksum; this is the hash
# of https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh, equal to
# the hash from an independent mirror
# (https://cdn.jsdelivr.net/gh/nvm-sh/nvm@v0.39.5/install.sh).
export NVM_INSTALL_SHA256="69da4f89f430cd5d6e591c2ccfa2e9e3ad55564ba60f651f00da85e04010c640"

# Accepted exceptions: downloads that are NOT hash-verified, because their
# content changes at a stable URL, so a pinned digest would break the install
# the next time the publisher updates the file (a pin would have to be bumped
# by hand, with nothing to say what the new content is):
#   - tailscale: https://tailscale.com/install.sh (extras/tailscale.sh), the
#     vendor's install script, updated in place
#   - get.docker.com: the convenience script run by setup, updated in place
#   - dotnet-install: https://dot.net/v1/dotnet-install.sh, updated in place
#   - getvsdbg: https://aka.ms/getvsdbgsh (download-csharp-debugger.sh), a
#     redirect to the current debugger installer
#   - minikube: the `releases/latest` .deb (extras/minikube.sh), a moving
#     "latest" target; verifiable only once it is version-pinned
# Revisit an exception when its publisher offers a versioned URL or a
# published checksum.

# ============================================================================
# Tool Paths and Aliases
# ============================================================================

# Use pnpm as primary package manager
export NPM_CLIENT="pnpm"

# ============================================================================
# Environment Configuration
# ============================================================================

# Disable strict TLS (only if needed for corporate environments)
# Uncomment if you see NODE_TLS_REJECT_UNAUTHORIZED errors
# export NODE_TLS_REJECT_UNAUTHORIZED=0

# Node.js cache directory
export NODE_CACHE_DIR="${DEVENV_ROOT:-$_DEVENV_SELF_ROOT}/.debug/node-cache"
mkdir -p "$NODE_CACHE_DIR"

# NPM cache configuration
export npm_config_cache="${NODE_CACHE_DIR}/npm"

# PNPM configuration
export PNPM_HOME="${DEVENV_ROOT:-$_DEVENV_SELF_ROOT}/.debug/pnpm"
export PNPM_STORE_DIR="${DEVENV_ROOT:-$_DEVENV_SELF_ROOT}/.debug/pnpm-store"

# PNPM non-interactive safety: pnpm must never block a headless session on a
# confirmation prompt (module purge, build-approval, etc.). CI mode disables
# interactive prompts and fails fast instead.
export CI="${CI:-true}"

# ============================================================================
# Version Verification Functions
# ============================================================================

# Verify Node.js version matches expected
verify_node_version() {
    local current_version
    current_version=$(node -v 2>/dev/null | cut -d'v' -f2)
    
    if [ -z "$current_version" ]; then
        echo "WARNING: Node.js is not installed" >&2
        return 1
    fi
    
    # Extract major.minor.patch
    local expected="${NODE_VERSION}"
    local expected_major
    expected_major=$(echo "$expected" | cut -d. -f1)
    local expected_minor
    expected_minor=$(echo "$expected" | cut -d. -f2)
    local current_major
    current_major=$(echo "$current_version" | cut -d. -f1)
    local current_minor
    current_minor=$(echo "$current_version" | cut -d. -f2)
    
    # Check major.minor match (patch can differ)
    if [ "$expected_major" != "$current_major" ] || [ "$expected_minor" != "$current_minor" ]; then
        echo "WARNING: Node.js version mismatch" >&2
        echo "  Expected: $expected (major.minor)" >&2
        echo "  Got: $current_version" >&2
        return 1
    fi
    
    return 0
}

# Verify PNPM version matches expected
verify_pnpm_version() {
    local current_version
    current_version=$(pnpm -v 2>/dev/null)
    
    if [ -z "$current_version" ]; then
        echo "WARNING: PNPM is not installed" >&2
        return 1
    fi
    
    if [ "$current_version" != "$PNPM_VERSION" ]; then
        echo "WARNING: PNPM version mismatch" >&2
        echo "  Expected: $PNPM_VERSION" >&2
        echo "  Got: $current_version" >&2
        return 1
    fi
    
    return 0
}

# Reclaim ownership of a stale pre-installed global pnpm module. The node
# devcontainer feature installs pnpm as root during image build; npm run as
# the current user then can't rename/replace it in place and fails EACCES.
# Safe to call even when no such directory exists.
reclaim_global_pnpm_ownership() {
    local npm_global_pnpm
    npm_global_pnpm="$(npm root -g 2>/dev/null)/pnpm"
    if [ -e "$npm_global_pnpm" ] && [ "$(stat -c '%U' "$npm_global_pnpm" 2>/dev/null)" != "$(whoami)" ]; then
        sudo chown -R "$(whoami)":"$(whoami)" "$npm_global_pnpm"
    fi
}

# Install or update tools to expected versions
ensure_tool_versions() {
    echo "Checking tool versions..."
    
    # Check Node.js
    if ! verify_node_version 2>/dev/null; then
        echo "Installing Node.js $NODE_VERSION..."
        # nvm is a shell function loaded from nvm.sh, not a PATH executable.
        # bootstrap.bash only sources it in interactive shells, so load it
        # here too since ensure_tool_versions may run non-interactively.
        if ! command -v nvm &> /dev/null; then
            export NVM_DIR="${NVM_DIR:-/usr/local/share/nvm}"
            # shellcheck disable=SC1091
            [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
        fi
        if command -v nvm &> /dev/null; then
            nvm install "$NODE_VERSION"
            nvm use "$NODE_VERSION"
        else
            echo "ERROR: nvm not found, cannot install Node.js" >&2
            return 1
        fi
    fi
    
    # Check PNPM
    if ! verify_pnpm_version 2>/dev/null; then
        echo "Installing PNPM $PNPM_VERSION..."
        reclaim_global_pnpm_ownership
        npm install -g "pnpm@$PNPM_VERSION" 2>&1 | grep -v 'NODE_TLS_REJECT_UNAUTHORIZED'
    fi
    
    echo "Tool versions verified"
    return 0
}

# ============================================================================
# Information Functions
# ============================================================================

# Display current tool versions
show_tool_versions() {
    echo "========================================="
    echo "Tool Versions"
    echo "========================================="
    echo "Standard Versions:"
    echo "  Node.js: $NODE_VERSION"
    echo "  NPM: $NPM_VERSION"
    echo "  PNPM: $PNPM_VERSION"
    echo ""
    echo "Current Installed Versions:"
    if command -v node &> /dev/null; then
        echo "  Node.js: $(node -v)"
    else
        echo "  Node.js: NOT INSTALLED"
    fi
    
    if command -v npm &> /dev/null; then
        echo "  NPM: $(npm -v)"
    else
        echo "  NPM: NOT INSTALLED"
    fi
    
    if command -v pnpm &> /dev/null; then
        echo "  PNPM: $(pnpm -v)"
    else
        echo "  PNPM: NOT INSTALLED"
    fi
    echo "========================================="
}

# Export functions so they're available to sourcing scripts (bash only — zsh does not support export -f)
if [[ -n "${BASH_VERSION:-}" ]]; then
    export -f verify_node_version
    export -f verify_pnpm_version
    export -f reclaim_global_pnpm_ownership
    export -f ensure_tool_versions
    export -f show_tool_versions
fi
