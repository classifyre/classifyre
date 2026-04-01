#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${IMAGE_TAG:-classifyre/all-in-one:local}"
PORT="${PORT:-3300}"
CONTAINER_NAME="${CONTAINER_NAME:-classifyre-allinone-smoke}"
BUILD_IMAGE="${BUILD_IMAGE:-1}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi

if [[ "${BUILD_IMAGE}" == "1" ]]; then
  bash /unstructured/scripts/docker-build-allinone.sh
fi

docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

TMP_DIR="$(mktemp -d)"
on_exit() {
  local exit_code="$1"
  if [[ "${exit_code}" -ne 0 ]]; then
    docker logs "${CONTAINER_NAME}" >/dev/null 2>&1 && docker logs "${CONTAINER_NAME}" >&2 || true
  fi
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  rm -rf "${TMP_DIR}"
}
trap 'on_exit "$?"' EXIT

mkdir -p \
  "${TMP_DIR}/postgres" \
  "${TMP_DIR}/uv-cache" \
  "${TMP_DIR}/playwright" \
  "${TMP_DIR}/runner-logs"
chmod -R 0777 "${TMP_DIR}"

docker run -d \
  --name "${CONTAINER_NAME}" \
  -p "${PORT}:3000" \
  -v "${TMP_DIR}/postgres:/var/lib/postgresql/data" \
  -v "${TMP_DIR}/uv-cache:/cache/uv" \
  -v "${TMP_DIR}/playwright:/ms-playwright" \
  -v "${TMP_DIR}/runner-logs:/var/lib/classifyre/runner-logs" \
  "${IMAGE_TAG}" >/dev/null

for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/ping" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

curl -fsS "http://127.0.0.1:${PORT}/api/ping" >/dev/null
curl -fsSI "http://127.0.0.1:${PORT}/" >/dev/null

docker exec \
  --user 10001:10001 \
  --env HOME=/tmp \
  --env UV_CACHE_DIR=/cache/uv \
  --env CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS=1 \
  "${CONTAINER_NAME}" \
  sh -lc '
    cd /app/apps/cli
    .venv/bin/python -c "from src.sources.dependencies import require_module; require_module(\"boto3\", \"S3 Compatible Storage\", [\"s3-compatible-storage\"]); print(\"optional dependency install ok\")"
  ' >/dev/null

echo "All-in-one smoke test passed for ${IMAGE_TAG} on port ${PORT}"
