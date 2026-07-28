#!/usr/bin/env bash
# Tear down the local writable deployment and close the VPS database tunnel.
# The VPS cluster and its data are untouched — only the local release and the
# tunnel container go away.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -qx classifyre; then
  # The profile's env guard keeps the plain `dev` profile from activating here
  # and deleting the wrong release.
  CLASSIFYRE_VPS_DB_HOST="teardown" \
  CLASSIFYRE_VPS_DB_PASSWORD="teardown" \
  CLASSIFYRE_VPS_AUTO_MIGRATE="false" \
    skaffold delete --profile dev-vps-db --kube-context k3d-classifyre || true
else
  echo "k3d cluster 'classifyre' does not exist"
fi

"${SCRIPT_DIR}/vps-db-tunnel.sh" stop
