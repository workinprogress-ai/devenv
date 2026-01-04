#!/usr/bin/env bash
set -euo pipefail

# Install Flatpak package manager
# Flatpak provides sandboxed applications and access to Flathub repository.
# Useful for installing additional desktop applications in the container.

sudo apt-get update -y
sudo apt-get install -y flatpak
sudo flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
