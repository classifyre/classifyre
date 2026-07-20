#!/usr/bin/env bash
set -euo pipefail

if k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -qx classifyre; then
  k3d cluster delete classifyre
  echo "Deleted k3d cluster and its container-owned dependency caches."
else
  echo "k3d cluster 'classifyre' does not exist"
fi
