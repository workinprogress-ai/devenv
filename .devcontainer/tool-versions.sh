#!/bin/bash
# tool-versions.sh - Standardized tool and version management for devenv
# Sources this file to ensure consistent tool versions across the environment
# Version: 1.0.0
# Author: WorkInProgress.ai

# This script should be sourced in .bashrc and bootstrap.sh to ensure
# consistent Node.js and npm/pnpm versions across all environments.

# ============================================================================
# Node.js and NPM/PNPM Versions
# ============================================================================

# Node.js version (use LTS)
# Update this when upgrading Node.js across the team
export NODE_VERSION="20.14.0"  # LTS as of 2026-01-01

# NPM version (comes with Node.js, use "latest" or specific version)
export NPM_VERSION="10.7.0"

# PNPM version - our standardized package manager
# IMPORTANT: Keep this synchronized across all environments
export PNPM_VERSION="8.7.1"

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
export NODE_CACHE_DIR="${DEVENV_ROOT:-.}/.debug/node-cache"
mkdir -p "$NODE_CACHE_DIR"

# NPM cache configuration
export npm_config_cache="${NODE_CACHE_DIR}/npm"

# PNPM configuration
export PNPM_HOME="${DEVENV_ROOT:-.}/.debug/pnpm"
export PNPM_STORE_DIR="${DEVENV_ROOT:-.}/.debug/pnpm-store"

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
    local expected_major=$(echo "$expected" | cut -d. -f1)
    local expected_minor=$(echo "$expected" | cut -d. -f2)
    local current_major=$(echo "$current_version" | cut -d. -f1)
    local current_minor=$(echo "$current_version" | cut -d. -f2)
    
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

# Install or update tools to expected versions
ensure_tool_versions() {
    echo "Checking tool versions..."
    
    # Check Node.js
    if ! verify_node_version 2>/dev/null; then
        echo "Installing Node.js $NODE_VERSION..."
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

# Export functions so they're available to sourcing scripts
export -f verify_node_version
export -f verify_pnpm_version
export -f ensure_tool_versions
export -f show_tool_versions
