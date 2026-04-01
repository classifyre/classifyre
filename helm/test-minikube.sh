#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-classifyre-dev}"
RELEASE="${RELEASE:-classifyre}"
CHART_DIR="$(cd "$(dirname "$0")/classifyre" && pwd)"
VALUES_FILE="${VALUES_FILE:-${CHART_DIR}/values-minikube.yaml}"
PORT="${PORT:-3100}"
APP_IMAGE="${APP_IMAGE:-classifyre/all-in-one:k8s-dev}"
APP_IMAGE_REPO="${APP_IMAGE%:*}"
APP_IMAGE_TAG="${APP_IMAGE##*:}"
REBUILD_IMAGE="${REBUILD_IMAGE:-0}"
IMAGE_REBUILT=0

if ! command -v minikube >/dev/null 2>&1; then
  echo "minikube is required" >&2
  exit 1
fi
if ! command -v helm >/dev/null 2>&1; then
  echo "helm is required" >&2
  exit 1
fi
if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required" >&2
  exit 1
fi

if ! minikube status >/dev/null 2>&1; then
  minikube start --driver=docker
fi
kubectl create namespace "${NAMESPACE}" >/dev/null 2>&1 || true

cleanup_legacy_postgres_resource() {
  local kind="$1"
  local name="${RELEASE}-postgres"

  if ! kubectl -n "${NAMESPACE}" get "${kind}/${name}" >/dev/null 2>&1; then
    return
  fi

  local managed_by
  local owner_release
  local owner_namespace
  managed_by="$(kubectl -n "${NAMESPACE}" get "${kind}/${name}" -o jsonpath='{.metadata.labels.app\.kubernetes\.io/managed-by}' 2>/dev/null || true)"
  owner_release="$(kubectl -n "${NAMESPACE}" get "${kind}/${name}" -o jsonpath='{.metadata.annotations.meta\.helm\.sh/release-name}' 2>/dev/null || true)"
  owner_namespace="$(kubectl -n "${NAMESPACE}" get "${kind}/${name}" -o jsonpath='{.metadata.annotations.meta\.helm\.sh/release-namespace}' 2>/dev/null || true)"

  if [[ "${managed_by}" == "Helm" && "${owner_release}" == "${RELEASE}" && "${owner_namespace}" == "${NAMESPACE}" ]]; then
    return
  fi

  echo "Removing legacy ${kind}/${name} (not owned by Helm release ${RELEASE})."
  kubectl -n "${NAMESPACE}" delete "${kind}/${name}" >/dev/null 2>&1 || true
}

cleanup_legacy_postgres_resource "service"
cleanup_legacy_postgres_resource "deployment"

if [[ "${REBUILD_IMAGE}" == "1" ]] || ! minikube image ls | grep -Fq "${APP_IMAGE}"; then
  CLASSIFYRE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  API_DIST="${API_DIST:-/tmp/classifyre-api-dist}"
  CODEGEN="${CODEGEN:-/tmp/classifyre-codegen}"

  if ! command -v bun >/dev/null 2>&1; then
    echo "bun is required to build JS artifacts." >&2
    exit 1
  fi

  echo "Building JS artifacts..."
  cd "${CLASSIFYRE_ROOT}"
  bun install --frozen-lockfile
  bun run codegen
  (cd apps/api && bun run build)
  mkdir -p "${API_DIST}" "${CODEGEN}"
  rm -rf "${API_DIST:?}"/* "${CODEGEN:?}"/*
  cp -r apps/api/dist/. "${API_DIST}/"
  cp -r packages/api-client/src/generated/. "${CODEGEN}/"

  chmod a+r package.json bun.lock Dockerfile >/dev/null 2>&1 || true
  find apps packages -type f -exec chmod a+r {} + >/dev/null 2>&1 || true

  # Use minikube's docker daemon directly so --build-context is supported
  eval "$(minikube docker-env)"
  DOCKER_BUILDKIT=1 docker build \
    --build-arg WEB_API_URL=http://classifyre-api:8000 \
    --build-context "api-dist=${API_DIST}" \
    --build-context "codegen=${CODEGEN}" \
    -t "${APP_IMAGE}" \
    -f "${CLASSIFYRE_ROOT}/Dockerfile" \
    "${CLASSIFYRE_ROOT}"
  IMAGE_REBUILT=1
else
  echo "Using cached minikube image ${APP_IMAGE}. Set REBUILD_IMAGE=1 to force rebuild."
fi

helm upgrade --install "${RELEASE}" "${CHART_DIR}" -n "${NAMESPACE}" -f "${VALUES_FILE}" \
  --set api.image.repository="${APP_IMAGE_REPO}" \
  --set api.image.tag="${APP_IMAGE_TAG}" \
  --set frontend.image.repository="${APP_IMAGE_REPO}" \
  --set frontend.image.tag="${APP_IMAGE_TAG}" \
  --set api.cliJobs.image.repository="${APP_IMAGE_REPO}" \
  --set api.cliJobs.image.tag="${APP_IMAGE_TAG}" \
  --wait --timeout 10m

if [[ "${IMAGE_REBUILT}" == "1" ]]; then
  kubectl -n "${NAMESPACE}" rollout restart deploy/${RELEASE}-api
  kubectl -n "${NAMESPACE}" rollout restart deploy/${RELEASE}-web
fi

kubectl -n "${NAMESPACE}" rollout status deploy/${RELEASE}-api --timeout=300s
kubectl -n "${NAMESPACE}" rollout status deploy/${RELEASE}-web --timeout=300s

kubectl -n "${NAMESPACE}" port-forward svc/${RELEASE}-web "${PORT}:3100" >/tmp/${RELEASE}-port-forward.log 2>&1 &
PF_PID=$!
trap 'kill ${PF_PID} >/dev/null 2>&1 || true' EXIT
sleep 4

curl --retry 20 --retry-delay 2 --retry-connrefused -fsS "http://127.0.0.1:${PORT}/" >/dev/null
curl --retry 20 --retry-delay 2 --retry-connrefused -fsS "http://127.0.0.1:${PORT}/api/ping" | grep -q "pong"

echo "Minikube validation succeeded."
echo "  Frontend: http://127.0.0.1:${PORT}/"
echo "  API ping: http://127.0.0.1:${PORT}/api/ping"
