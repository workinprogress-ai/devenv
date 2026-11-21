#!/usr/bin/env bash
set -euo pipefail

# Meta-installer for the Kubernetes tooling set: k3d, k9s, telepresence.
# These tools serve local AND remote clusters (k9s and telepresence target
# any kubeconfig context — local k3d, staging, prod), so the set is provided
# as one entry point for any cluster workflow, not only local development.
# Fail-fast: the first failed component aborts the run.
EXTRAS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for script in k3d.sh k9s.sh telepresence.sh; do
  echo "==> install-extras: ${script}"
  bash "${EXTRAS_DIR}/${script}"
done

echo ""
echo "Kubernetes tooling set installed:"
k3d version
k9s version --short 2>/dev/null || k9s version
telepresence version
