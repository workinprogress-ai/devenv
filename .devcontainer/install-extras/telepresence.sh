#!/usr/bin/env bash
set -euo pipefail

# Install telepresence (OSS) — traffic interception for Kubernetes debug
# tier 2, used by the kube-intercept wrapper.
#
# The pin is load-bearing: releases after v2.20.3 moved the login wall
# (Ambassador Cloud account required) ahead of `telepresence connect`.
# v2.20.3 is the newest wall-free OSS release. Do not bump to latest.
# If this release ever disappears upstream, mirror it under org control.
TELEPRESENCE_VERSION="2.20.3"

echo "Installing telepresence OSS v${TELEPRESENCE_VERSION}..."

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)   ARCH_SUFFIX="amd64" ;;
  aarch64|arm64) ARCH_SUFFIX="arm64" ;;
  *)
    echo "ERROR: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

DOWNLOAD_URL="https://github.com/telepresenceio/telepresence/releases/download/v${TELEPRESENCE_VERSION}/telepresence-linux-${ARCH_SUFFIX}"
TMP_BIN="$(mktemp)"

if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMP_BIN"; then
  echo "ERROR: Failed to download telepresence from $DOWNLOAD_URL"
  rm -f "$TMP_BIN"
  exit 1
fi

chmod +x "$TMP_BIN" || { rm -f "$TMP_BIN"; echo "ERROR: chmod failed"; exit 1; }
sudo mv "$TMP_BIN" /usr/local/bin/telepresence || { rm -f "$TMP_BIN"; echo "ERROR: install failed"; exit 1; }

if ! command -v telepresence &> /dev/null; then
  echo "ERROR: telepresence installation failed"
  exit 1
fi

echo "telepresence installed successfully"
telepresence version
