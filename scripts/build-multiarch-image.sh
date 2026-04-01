#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Build and publish/load a multi-platform Docker image for the all-in-one runtime.

Usage:
  scripts/build-multiarch-image.sh --image <name> --tag <tag> [options]

Required:
  --image <name>           Image name, e.g. classifyre/all-in-one
  --tag <tag>              Image tag, e.g. v1.2.3

Options:
  --platforms <list>       Target platforms (default: linux/amd64,linux/arm64)
  --file <path>            Dockerfile path (default: Dockerfile)
  --context <path>         Build context path (default: repo root)
  --builder <name>         Buildx builder name (default: classifyre-multiarch)
  --push                   Push manifest + images to registry (default)
  --load                   Load single-arch image into local Docker daemon
  --latest                 Also tag and push/load :latest
  --help                   Show this help

Examples:
  scripts/build-multiarch-image.sh \
    --image classifyre/all-in-one \
    --tag v1.0.0 \
    --push

  scripts/build-multiarch-image.sh \
    --image classifyre/all-in-one \
    --tag dev \
    --platforms linux/arm64 \
    --load
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

IMAGE=""
TAG=""
PLATFORMS="linux/amd64,linux/arm64"
DOCKERFILE_PATH="${REPO_ROOT}/Dockerfile"
CONTEXT_PATH="${REPO_ROOT}"
BUILDER_NAME="classifyre-multiarch"
MODE="push"
ALSO_LATEST="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)
      IMAGE="${2:-}"
      shift 2
      ;;
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --platforms)
      PLATFORMS="${2:-}"
      shift 2
      ;;
    --file)
      DOCKERFILE_PATH="${2:-}"
      shift 2
      ;;
    --context)
      CONTEXT_PATH="${2:-}"
      shift 2
      ;;
    --builder)
      BUILDER_NAME="${2:-}"
      shift 2
      ;;
    --push)
      MODE="push"
      shift
      ;;
    --load)
      MODE="load"
      shift
      ;;
    --latest)
      ALSO_LATEST="1"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "${IMAGE}" || -z "${TAG}" ]]; then
  echo "--image and --tag are required." >&2
  usage
  exit 1
fi

API_DIST="${API_DIST:-/tmp/classifyre-api-dist}"
CODEGEN="${CODEGEN:-/tmp/classifyre-codegen}"

if [[ "${MODE}" == "load" && "${PLATFORMS}" == *","* ]]; then
  echo "--load supports only a single platform. Use --push for multi-platform manifests." >&2
  exit 1
fi

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
mkdir -p "${API_DIST}" "${CODEGEN}"
rm -rf "${API_DIST:?}"/* "${CODEGEN:?}"/*
cp -r apps/api/dist/. "${API_DIST}/"
cp -r packages/api-client/src/generated/. "${CODEGEN}/"

if ! docker buildx inspect "${BUILDER_NAME}" >/dev/null 2>&1; then
  docker buildx create --name "${BUILDER_NAME}" --driver docker-container --use >/dev/null
fi
docker buildx use "${BUILDER_NAME}" >/dev/null
docker buildx inspect --bootstrap >/dev/null

BUILD_ARGS=(
  --platform "${PLATFORMS}"
  -f "${DOCKERFILE_PATH}"
  -t "${IMAGE}:${TAG}"
  --build-context "api-dist=${API_DIST}"
  --build-context "codegen=${CODEGEN}"
)

if [[ "${ALSO_LATEST}" == "1" ]]; then
  BUILD_ARGS+=(-t "${IMAGE}:latest")
fi

if [[ "${MODE}" == "push" ]]; then
  BUILD_ARGS+=(--push)
else
  BUILD_ARGS+=(--load)
fi

echo "Building ${IMAGE}:${TAG}"
echo "Platforms: ${PLATFORMS}"
echo "Mode: ${MODE}"
docker buildx build "${BUILD_ARGS[@]}" "${CONTEXT_PATH}"
