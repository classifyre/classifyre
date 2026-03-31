#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Render and persist Helm manifest snapshots.

Usage:
  scripts/helm-snapshot.sh [--check] [--out-dir <path>]

Options:
  --check            Verify snapshots are up to date (no writes).
  --out-dir <path>   Output directory (default: helm/snapshots).
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CHART_DIR="${CHART_DIR:-${REPO_ROOT}/helm/classifyre}"
OUT_DIR_DEFAULT="${REPO_ROOT}/helm/snapshots"
OUT_DIR="${OUT_DIR_DEFAULT}"
CHECK_MODE=0
HELM_COMMON_ARGS=(
  --set "postgres.external.password=${POSTGRES_EXTERNAL_PASSWORD:-snapshot-password}"
  --set "api.maskedConfigEncryption.value=${CLASSIFYRE_MASKED_CONFIG_KEY:-snapshot-classifyre-masked-key-0001}"
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      CHECK_MODE=1
      shift
      ;;
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
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

if ! command -v helm >/dev/null 2>&1; then
  echo "helm is required." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

render_snapshot() {
  local values_file="$1"
  local output_file="$2"
  helm template classifyre "${CHART_DIR}" -f "${values_file}" "${HELM_COMMON_ARGS[@]}" > "${output_file}"
}

mkdir -p "${TMP_DIR}"
render_snapshot "${CHART_DIR}/values.yaml" "${TMP_DIR}/default.yaml"
render_snapshot "${CHART_DIR}/values-minikube.yaml" "${TMP_DIR}/minikube.yaml"

if [[ "${CHECK_MODE}" -eq 1 ]]; then
  missing=0
  for file in default.yaml minikube.yaml; do
    if [[ ! -f "${OUT_DIR}/${file}" ]]; then
      echo "Missing snapshot: ${OUT_DIR}/${file}" >&2
      missing=1
      continue
    fi
    if ! diff -u "${OUT_DIR}/${file}" "${TMP_DIR}/${file}" >/dev/null; then
      echo "Snapshot out of date: ${OUT_DIR}/${file}" >&2
      diff -u "${OUT_DIR}/${file}" "${TMP_DIR}/${file}" || true
      exit 1
    fi
  done
  if [[ "${missing}" -eq 1 ]]; then
    exit 1
  fi
  echo "Helm snapshots are up to date."
  exit 0
fi

mkdir -p "${OUT_DIR}"
cp "${TMP_DIR}/default.yaml" "${OUT_DIR}/default.yaml"
cp "${TMP_DIR}/minikube.yaml" "${OUT_DIR}/minikube.yaml"

echo "Helm snapshots updated in ${OUT_DIR}"
