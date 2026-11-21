#!/usr/bin/env bash
set -euo pipefail

# Install k9s - Kubernetes terminal UI
# Resolves assets from the GitHub releases API (asset layouts change between
# releases — a guessed URL returns "Not Found" that curl will happily save),
# verifies the sha256 checksum, installs to ~/.local/bin (no sudo).

echo "Installing k9s..."

case "$(uname -m)" in
  x86_64)  K9S_ASSET="k9s_Linux_amd64.tar.gz" ;;
  aarch64) K9S_ASSET="k9s_Linux_arm64.tar.gz" ;;
  *) echo "ERROR: unsupported architecture: $(uname -m)"; exit 1 ;;
esac

API="https://api.github.com/repos/derailed/k9s/releases/latest"
K9S_URL=$(curl -fsSL "$API" | grep -o "https://[^\"]*/${K9S_ASSET}" | head -1)
SUMS_URL=$(curl -fsSL "$API" | grep -o 'https://[^"]*/checksums\.sha256' | head -1)
if [ -z "$K9S_URL" ] || [ -z "$SUMS_URL" ]; then
  echo "ERROR: could not resolve k9s release assets from GitHub API"
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# Download under the asset's own filename — checksums.sha256 lists assets
# by name, so the local filename must match for sha256sum -c to find it.
curl -fsSL -o "$TMP/$K9S_ASSET" "$K9S_URL"
curl -fsSL -o "$TMP/checksums.sha256" "$SUMS_URL"
grep " ${K9S_ASSET}\$" "$TMP/checksums.sha256" | (cd "$TMP" && sha256sum -c -)

tar -xzf "$TMP/$K9S_ASSET" -C "$TMP" k9s
mkdir -p ~/.local/bin
mv "$TMP/k9s" ~/.local/bin/k9s
chmod +x ~/.local/bin/k9s

echo "k9s installed successfully"
k9s version --short
