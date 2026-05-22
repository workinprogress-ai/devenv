#!/usr/bin/env bash
set -euo pipefail

# Install Firefox ESR web browser
# Firefox Extended Support Release - a stable version of Firefox.
# Useful for testing and web development in the container desktop environment.

sudo apt-get update -y
sudo apt-get install -y firefox-esr

if [[ -f "${HOME}/.fluxbox/menu" ]]; then
    devenv-desktop-menu-add-folder "Applications"
    devenv-desktop-menu-add-shortcut "Firefox" "firefox-esr" "Applications"
fi
