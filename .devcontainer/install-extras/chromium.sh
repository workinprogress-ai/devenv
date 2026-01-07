#!/usr/bin/env bash
set -euo pipefail

# Install Chromium web browser
# Chromium is the open-source browser that Chrome is based on.
# Useful for testing and web development in the container desktop environment.

sudo apt-get update -y
sudo apt-get install -y chromium