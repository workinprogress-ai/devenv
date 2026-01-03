#!/usr/bin/env bash
set -euo pipefail

# Install Helm package manager for Kubernetes
# This script adds the Helm repository and installs Helm from the official Debian package

echo "Installing Helm..."

# Add Helm GPG key
if ! curl -fsSL https://baltocdn.com/helm/signing.asc 2>/dev/null | gpg --dearmor 2>/dev/null | sudo tee /usr/share/keyrings/helm.gpg > /dev/null 2>&1; then
  echo "ERROR: Failed to fetch and import Helm GPG key"
  exit 1
fi

# Add Helm repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/helm.gpg] https://baltocdn.com/helm/stable/debian/ all main" | sudo tee /etc/apt/sources.list.d/helm-stable-debian.list > /dev/null

# Update package list and install Helm
sudo apt-get update -y
if ! sudo apt-get install -y helm; then
  echo "ERROR: Failed to install Helm"
  exit 1
fi

echo "Helm installed successfully"
helm version
