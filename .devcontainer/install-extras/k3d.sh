#!/usr/bin/env bash
set -euo pipefail

# Install k3d — k3s cluster factory for the local environment.
# k3d creates disposable k3s clusters inside the dev container's Docker
# daemon. Pinned: deterministic installs; bump deliberately.
K3D_VERSION="5.9.0"

echo "Installing k3d v${K3D_VERSION}..."

# Environment pre-flight: k3s (inside k3d node containers) hard-requires the
# cpuset cgroup controller — clusters hang at startup without it. The binary
# installs fine either way (it also drives remote clusters), so this is a
# warning with the fix pointer, not a refusal.
if [ -r "${DEVENV_CGROUP_CONTROLLERS_OVERRIDE:-/sys/fs/cgroup/cgroup.controllers}" ] \
    && ! grep -qw cpuset "${DEVENV_CGROUP_CONTROLLERS_OVERRIDE:-/sys/fs/cgroup/cgroup.controllers}" 2>/dev/null; then
    echo ""
    echo "WARNING: the cpuset cgroup controller is missing — k3d CLUSTERS will hang"
    echo "at startup on this machine (the binary itself is fine, and remote-cluster"
    echo "workflows are unaffected)."
    echo "Fix on the host:  .host/cpuset-delegate.sh (durable) or .host/cpuset-live-toggle.sh (this container)"
    echo "Details: docs/Dev-container-environment.md — Host preparation: cpuset delegation"
    echo ""
fi

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

# install(1): atomically places a root-owned 755 binary (mktemp files are
# 0600 user-owned; chmod+mv would leave a user-writable file on PATH).
sudo install -m 755 "$TMP_BIN" /usr/local/bin/k3d || { rm -f "$TMP_BIN"; echo "ERROR: install failed"; exit 1; }
rm -f "$TMP_BIN"

if ! command -v k3d &> /dev/null; then
  echo "ERROR: k3d installation failed"
  exit 1
fi

echo "k3d installed successfully"
k3d version
