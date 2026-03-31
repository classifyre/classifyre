#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

IMAGE_TAG="${IMAGE_TAG:-classifyre-all-in-one:local}"
DOCKERFILE_PATH="${DOCKERFILE_PATH:-${REPO_ROOT}/Dockerfile}"
CONTEXT_PATH="${CONTEXT_PATH:-${REPO_ROOT}}"
WEB_API_URL="${WEB_API_URL:-http://127.0.0.1:8000}"
API_DIST="${API_DIST:-/tmp/classifyre-api-dist}"
CODEGEN="${CODEGEN:-/tmp/classifyre-codegen}"
WEB_DIST="${WEB_DIST:-/tmp/classifyre-web-dist}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required to build JS artifacts." >&2
  exit 1
fi

echo "Building JS artifacts..."
cd "${REPO_ROOT}"
bun install --frozen-lockfile
bun run codegen
(cd apps/api && bun run build)
(cd apps/web && NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-/api}" bun run build)
mkdir -p "${API_DIST}" "${CODEGEN}" "${WEB_DIST}"
rm -rf "${API_DIST:?}"/* "${CODEGEN:?}"/* "${WEB_DIST:?}"/*
cp -r apps/api/dist/. "${API_DIST}/"
cp -r packages/api-client/src/generated/. "${CODEGEN}/"
mkdir -p "${WEB_DIST}/standalone" "${WEB_DIST}/static" "${WEB_DIST}/public"
cp -rL apps/web/.next/standalone/. "${WEB_DIST}/standalone/"
cp -rL apps/web/.next/static/. "${WEB_DIST}/static/"
if [[ -d apps/web/public ]]; then
  cp -rL apps/web/public/. "${WEB_DIST}/public/"
fi
touch "${WEB_DIST}/public/_ci_dir_marker"

echo "Building all-in-one image ${IMAGE_TAG}"
echo "Dockerfile: ${DOCKERFILE_PATH}"
echo "Context: ${CONTEXT_PATH}"

docker build \
  -f "${DOCKERFILE_PATH}" \
  --build-arg "WEB_API_URL=${WEB_API_URL}" \
  --build-context "api-dist=${API_DIST}" \
  --build-context "codegen=${CODEGEN}" \
  --build-context "web-dist=${WEB_DIST}" \
  -t "${IMAGE_TAG}" \
  "${CONTEXT_PATH}"

echo "Built ${IMAGE_TAG}"
