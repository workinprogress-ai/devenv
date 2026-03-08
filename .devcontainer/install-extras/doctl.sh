#!/usr/bin/env bash
set -euo pipefail

# Install doctl - DigitalOcean CLI tool
# This script adds the DigitalOcean repository and installs doctl

echo "Installing doctl (DigitalOcean CLI)..."

# Add DigitalOcean GPG key
if ! curl -fsSL https://repos.insights.digitalocean.com/sonar-agent.asc 2>/dev/null | gpg --dearmor 2>/dev/null | sudo tee /usr/share/keyrings/digitalocean.gpg > /dev/null 2>&1; then
  echo "ERROR: Failed to fetch and import DigitalOcean GPG key"
  exit 1
fi

# Add DigitalOcean repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/digitalocean.gpg] https://repos.insights.digitalocean.com/apt/do-agent main main" | sudo tee /etc/apt/sources.list.d/digitalocean.list > /dev/null

# Alternative: Install from GitHub releases (more reliable)
DOCTL_VERSION=$(curl -s https://api.github.com/repos/digitalocean/doctl/releases/latest | grep '"tag_name":' | sed -E 's/.*"v([^"]+)".*/\1/')

if [ -z "$DOCTL_VERSION" ]; then
  echo "ERROR: Could not determine latest doctl version"
  exit 1
fi

echo "Downloading doctl v${DOCTL_VERSION}..."

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)
    ARCH_SUFFIX="amd64"
    ;;
  aarch64|arm64)
    ARCH_SUFFIX="arm64"
    ;;
  *)
    echo "ERROR: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

# Download and install doctl
DOWNLOAD_URL="https://github.com/digitalocean/doctl/releases/download/v${DOCTL_VERSION}/doctl-${DOCTL_VERSION}-linux-${ARCH_SUFFIX}.tar.gz"

if ! curl -fsSL "$DOWNLOAD_URL" -o /tmp/doctl.tar.gz; then
  echo "ERROR: Failed to download doctl from $DOWNLOAD_URL"
  exit 1
fi

# Extract and install
if ! sudo tar xf /tmp/doctl.tar.gz -C /usr/local/bin; then
  echo "ERROR: Failed to extract doctl"
  rm -f /tmp/doctl.tar.gz
  exit 1
fi

rm -f /tmp/doctl.tar.gz

# Verify installation
if ! command -v doctl &> /dev/null; then
  echo "ERROR: doctl installation failed"
  exit 1
fi

echo "doctl installed successfully"
doctl version

echo ""
echo "To authenticate with DigitalOcean, run:"
echo "  doctl auth init"
