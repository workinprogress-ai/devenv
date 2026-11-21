#!/usr/bin/env bash
set -euo pipefail

# Install doctl - DigitalOcean CLI tool
# This script adds the DigitalOcean repository and installs doctl

echo "Installing doctl (DigitalOcean CLI)..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/../tool-versions.bash"

# Add DigitalOcean GPG key
if ! curl -fsSL https://repos.insights.digitalocean.com/sonar-agent.asc 2>/dev/null | gpg --dearmor 2>/dev/null | sudo tee /usr/share/keyrings/digitalocean.gpg > /dev/null 2>&1; then
  echo "ERROR: Failed to fetch and import DigitalOcean GPG key"
  exit 1
fi

# Add DigitalOcean repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/digitalocean.gpg] https://repos.insights.digitalocean.com/apt/do-agent main main" | sudo tee /etc/apt/sources.list.d/digitalocean.list > /dev/null

echo "Downloading doctl v${DOCTL_VERSION}..."

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)
    ARCH_SUFFIX="amd64"
    EXPECTED_SHA256="$DOCTL_SHA256_AMD64"
    ;;
  aarch64|arm64)
    ARCH_SUFFIX="arm64"
    EXPECTED_SHA256="$DOCTL_SHA256_ARM64"
    ;;
  *)
    echo "ERROR: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

# Download and install doctl
DOWNLOAD_URL="https://github.com/digitalocean/doctl/releases/download/v${DOCTL_VERSION}/doctl-${DOCTL_VERSION}-linux-${ARCH_SUFFIX}.tar.gz"
ARCHIVE="/tmp/doctl-${DOCTL_VERSION}-${ARCH_SUFFIX}.tar.gz"
trap 'rm -f "$ARCHIVE"' EXIT

TMP_TARBALL="$(mktemp --suffix=.tar.gz)"

if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMP_TARBALL"; then
  echo "ERROR: Failed to download doctl from $DOWNLOAD_URL"
  rm -f "$TMP_TARBALL"
  exit 1
fi

# Extract and install
if ! sudo tar xf "$TMP_TARBALL" -C /usr/local/bin; then
  echo "ERROR: Failed to extract doctl"
  rm -f "$TMP_TARBALL"
  exit 1
fi

rm -f "$TMP_TARBALL"

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
