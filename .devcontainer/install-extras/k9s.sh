#!/usr/bin/env bash
set -euo pipefail

# Install k9s — terminal dashboard for Kubernetes clusters.
# Works across all kubeconfig contexts (local k3d, staging, prod).
# Pinned: deterministic installs; bump deliberately.
K9S_VERSION="0.51.0"

echo "Installing k9s v${K9S_VERSION}..."

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)   ARCH_SUFFIX="amd64" ;;
  aarch64|arm64) ARCH_SUFFIX="arm64" ;;
  *)
    echo "ERROR: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

DOWNLOAD_URL="https://github.com/derailed/k9s/releases/download/v${K9S_VERSION}/k9s_Linux_${ARCH_SUFFIX}.tar.gz"
TMP_TARBALL="$(mktemp --suffix=.tar.gz)"

if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMP_TARBALL"; then
  echo "ERROR: Failed to download k9s from $DOWNLOAD_URL"
  rm -f "$TMP_TARBALL"
  exit 1
fi

if ! sudo tar xf "$TMP_TARBALL" -C /usr/local/bin k9s; then
  echo "ERROR: Failed to extract k9s"
  rm -f "$TMP_TARBALL"
  exit 1
fi
rm -f "$TMP_TARBALL"

if ! command -v k9s &> /dev/null; then
  echo "ERROR: k9s installation failed"
  exit 1
fi

echo "k9s installed successfully"
k9s version --short 2>/dev/null || k9s version
