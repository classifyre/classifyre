#!/usr/bin/env bash
set -euo pipefail

# Rebuilds the web app the same way CI does (production `next build`, staged
# into the same Docker build context as the shipped image) and reloads it into
# the local k3d cluster. No dev server, no bind mount, no hot reload — run
# this after code changes and the deployment restarts once with the new build.
#
# Requires ./scripts/dev/create-cluster.sh and ./scripts/dev/start.sh to have
# been run first (the classifyre-dev namespace must already exist).

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${repo_root}"

for required_command in docker k3d kubectl bun; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Missing required command: ${required_command}" >&2
    exit 1
  fi
done

echo "==> Building apps/web (next build)"
(cd apps/web && bun run build)

stage_dir="$(mktemp -d)"
trap 'rm -rf "${stage_dir}"' EXIT

echo "==> Staging web-dist build context"
mkdir -p "${stage_dir}/standalone" "${stage_dir}/static" "${stage_dir}/public"
# Resolve symlinks the same way CI does (scripts/stage-docker-artifacts.sh):
# bun's workspace layout leaves dangling node_modules symlinks in the
# standalone output that a plain Docker COPY can't follow. `-xtype l` (GNU
# find) isn't available on macOS's BSD find, so check target existence by hand.
find apps/web/.next/standalone -type l | while IFS= read -r link; do
  [ -e "${link}" ] || rm -f "${link}"
done
cp -rL apps/web/.next/standalone/. "${stage_dir}/standalone/"
cp -r apps/web/.next/static/. "${stage_dir}/static/"
touch "${stage_dir}/public/_ci_dir_marker"
cp -r apps/web/public/. "${stage_dir}/public/" 2>/dev/null || true

echo "==> Building classifyre/web:dev-local image"
docker build \
  --target web-final \
  --build-context web-dist="${stage_dir}" \
  -t classifyre/web:dev-local \
  .

echo "==> Importing image into k3d-classifyre"
k3d image import classifyre/web:dev-local -c classifyre

echo "==> Restarting classifyre-web deployment"
kubectl --context k3d-classifyre -n classifyre-dev rollout restart deployment/classifyre-web
kubectl --context k3d-classifyre -n classifyre-dev rollout status deployment/classifyre-web --timeout=120s

echo "Done: classifyre-web is running the freshly built image."
