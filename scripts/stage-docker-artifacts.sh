#!/usr/bin/env bash

set -euo pipefail

DEST_ROOT="${1:-/tmp/classifyre-docker-artifacts}"
API_DIST="${DEST_ROOT}/api-dist"
CODEGEN="${DEST_ROOT}/codegen"
WEB_DIST="${DEST_ROOT}/web-dist"

if [[ ! -d apps/api/dist ]]; then
  echo "Error: apps/api/dist does not exist. Run the build first." >&2
  exit 1
fi

if [[ ! -d packages/api-client/src/generated ]]; then
  echo "Error: packages/api-client/src/generated does not exist. Run codegen first." >&2
  exit 1
fi

if [[ ! -d apps/web/.next/standalone || ! -d apps/web/.next/static ]]; then
  echo "Error: web standalone output is missing. Build the web app first." >&2
  exit 1
fi

mkdir -p "${API_DIST}" "${CODEGEN}" "${WEB_DIST}/standalone" "${WEB_DIST}/static" "${WEB_DIST}/public"
rm -rf "${API_DIST:?}/"* "${CODEGEN:?}/"* "${WEB_DIST:?}/"*
mkdir -p "${WEB_DIST}/standalone" "${WEB_DIST}/static" "${WEB_DIST}/public"

cp -r apps/api/dist/. "${API_DIST}/"
cp -r packages/api-client/src/generated/. "${CODEGEN}/"

# Resolve all symlinks before the Docker build context is staged (cp -rL).
# Bun's workspace layout leaves dangling symlinks in the standalone output:
#  - node_modules/.bun/ → global bun install cache (absent on CI / in Docker)
#  - apps/web/node_modules/next → not present; bun hoists it to root
#  - node_modules/typescript → dev-only dep, absent at runtime
# Prune every dangling symlink (-xtype l = symlink whose target doesn't exist)
# so cp -rL only sees real files and valid symlinks it can dereference.
find apps/web/.next/standalone -xtype l -delete
cp -rL apps/web/.next/standalone/. "${WEB_DIST}/standalone/"
cp -r apps/web/.next/static/. "${WEB_DIST}/static/"

# Preserve empty public dirs in the staged context.
touch "${WEB_DIST}/public/_ci_dir_marker"
cp -r apps/web/public/. "${WEB_DIST}/public/" 2>/dev/null || true
