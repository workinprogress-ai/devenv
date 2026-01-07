#!/usr/bin/env bash
set -euo pipefail

# Install Minikube - Local Kubernetes cluster
# Minikube runs a single-node Kubernetes cluster locally for development and testing.
# Supports both ARM64 and AMD64 architectures.

arch=$(uname -m)
is_arm=$([ "$arch" == "aarch64" ] && echo 1)

devenv_root=${devenv:-/workspaces/devenv}
mkdir -p "$devenv_root/.installs"
cd "$devenv_root/.installs"

if [ "$is_arm" == "1" ]; then
    if [ ! -f ./minikube.deb ]; then
        curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube_latest_arm64.deb
        mv minikube_latest_arm64.deb minikube.deb
    fi
else
    if [ ! -f ./minikube.deb ]; then
        curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube_latest_amd64.deb
        mv minikube_latest_amd64.deb minikube.deb
    fi
fi
sudo apt-get update -y
sudo apt-get install -y ./minikube.deb
cd - &>/dev/null