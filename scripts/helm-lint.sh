#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CHART_DIR="${CHART_DIR:-${REPO_ROOT}/helm/classifyre}"
HELM_COMMON_ARGS=(
  --set "postgres.external.password=${POSTGRES_EXTERNAL_PASSWORD:-snapshot-password}"
  --set "api.maskedConfigEncryption.value=${CLASSIFYRE_MASKED_CONFIG_KEY:-snapshot-classifyre-masked-key-0001}"
)

if ! command -v helm >/dev/null 2>&1; then
  echo "helm is required." >&2
  exit 1
fi

helm lint "${CHART_DIR}" "${HELM_COMMON_ARGS[@]}"
helm template classifyre "${CHART_DIR}" -f "${CHART_DIR}/values.yaml" "${HELM_COMMON_ARGS[@]}" >/dev/null
helm template classifyre "${CHART_DIR}" -f "${CHART_DIR}/values-minikube.yaml" "${HELM_COMMON_ARGS[@]}" >/dev/null

echo "Helm lint/template checks passed."
