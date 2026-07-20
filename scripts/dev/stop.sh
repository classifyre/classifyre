#!/usr/bin/env bash
set -euo pipefail

if k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -qx classifyre; then
  skaffold delete --profile dev --kube-context k3d-classifyre
else
  echo "k3d cluster 'classifyre' does not exist"
fi
