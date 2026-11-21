#!/usr/bin/env bash
set -euo pipefail

# Install k3d — k3s cluster factory for the local environment.
# k3d creates disposable k3s clusters inside the dev container's Docker
# daemon. Pinned: deterministic installs; bump deliberately.
K3D_VERSION="5.9.0"

echo "Installing k3d v${K3D_VERSION}..."

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)   ARCH_SUFFIX="amd64" ;;
  aarch64|arm64) ARCH_SUFFIX="arm64" ;;
  *)
    echo "ERROR: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

DOWNLOAD_URL="https://github.com/k3d-io/k3d/releases/download/v${K3D_VERSION}/k3d-linux-${ARCH_SUFFIX}"
TMP_BIN="$(mktemp)"

if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMP_BIN"; then
  echo "ERROR: Failed to download k3d from $DOWNLOAD_URL"
  rm -f "$TMP_BIN"
  exit 1
fi

chmod +x "$TMP_BIN" || { rm -f "$TMP_BIN"; echo "ERROR: chmod failed"; exit 1; }
sudo mv "$TMP_BIN" /usr/local/bin/k3d || { rm -f "$TMP_BIN"; echo "ERROR: install failed"; exit 1; }

if ! command -v k3d &> /dev/null; then
  echo "ERROR: k3d installation failed"
  exit 1
fi

echo "k3d installed successfully"
k3d version
