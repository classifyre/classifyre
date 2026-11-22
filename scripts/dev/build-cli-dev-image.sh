#!/usr/bin/env bash
# Rebuilds classifyre/cli:dev-local (published cli:latest + unixODBC and the
# query sources' clients, see development/cli-dev-image/Dockerfile) and loads
# it into the k3d cluster. Re-run after a newer classifyre/cli:latest exists.
#
# PULL=always (default) fetches cli:latest first; PULL=missing fetches it only
# when this machine has none (what `create-cluster.sh` uses, so setting up a
# cluster does not hit the registry when the image is already local).
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ "${PULL:-always}" = "always" ] || ! docker image inspect classifyre/cli:latest >/dev/null 2>&1; then
  docker pull classifyre/cli:latest
fi
docker build -t classifyre/cli:dev-local \
  --build-context cli="${repo_root}/apps/cli" \
  "${repo_root}/development/cli-dev-image"
k3d image import classifyre/cli:dev-local -c classifyre
