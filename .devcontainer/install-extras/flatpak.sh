#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update -y
sudo apt-get install -y flatpak
sudo flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
