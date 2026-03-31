#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

IMAGE="${IMAGE:-}"
TAG="${TAG:-}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
MODE="${MODE:-push}"
LATEST="${LATEST:-0}"

if [[ -z "${IMAGE}" || -z "${TAG}" ]]; then
  cat >&2 <<'EOF'
Usage via env vars:
  IMAGE=<registry/image> TAG=<tag> [PLATFORMS=linux/amd64,linux/arm64] [MODE=push|load] [LATEST=1]

Example:
  IMAGE=ghcr.io/acme/classifyre-all-in-one TAG=v1.0.0 MODE=push bash scripts/docker-build-multiarch.sh
EOF
  exit 1
fi

ARGS=(
  --image "${IMAGE}"
  --tag "${TAG}"
  --platforms "${PLATFORMS}"
)

if [[ "${MODE}" == "load" ]]; then
  ARGS+=(--load)
else
  ARGS+=(--push)
fi

if [[ "${LATEST}" == "1" ]]; then
  ARGS+=(--latest)
fi

exec bash "${SCRIPT_DIR}/build-multiarch-image.sh" "${ARGS[@]}"
