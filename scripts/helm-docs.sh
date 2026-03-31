#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Generate Helm chart docs using helm-docs (latest release).

Usage:
  scripts/helm-docs.sh [--check] [--chart-search-root <path>] [--chart <name>]

Options:
  --check                     Verify docs are up to date without modifying tracked files.
  --chart-search-root <path>  Chart root directory (default: helm).
  --chart <name>              Chart directory name under chart root (default: classifyre).
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CHART_SEARCH_ROOT="${REPO_ROOT}/helm"
CHART_NAME="classifyre"
CHECK_MODE=0
TOOLS_DIR="${REPO_ROOT}/.tools/helm-docs"
BIN_PATH="${TOOLS_DIR}/helm-docs"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      CHECK_MODE=1
      shift
      ;;
    --chart-search-root)
      CHART_SEARCH_ROOT="${2:-}"
      shift 2
      ;;
    --chart)
      CHART_NAME="${2:-}"
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

CHART_PATH="${CHART_SEARCH_ROOT}/${CHART_NAME}"
if [[ ! -d "${CHART_PATH}" ]]; then
  echo "Chart path not found: ${CHART_PATH}" >&2
  exit 1
fi

install_latest_helm_docs() {
  mkdir -p "${TOOLS_DIR}"

  local release_json tag version os arch asset_name asset_url tmp_dir
  release_json="$(curl -fsSL https://api.github.com/repos/norwoodj/helm-docs/releases/latest)"
  tag="$(printf '%s' "${release_json}" | jq -r '.tag_name')"
  version="${tag#v}"

  case "$(uname -s)" in
    Darwin) os="Darwin" ;;
    Linux) os="Linux" ;;
    *)
      echo "Unsupported OS for helm-docs installer: $(uname -s)" >&2
      exit 1
      ;;
  esac

  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="x86_64" ;;
    *)
      echo "Unsupported architecture for helm-docs installer: $(uname -m)" >&2
      exit 1
      ;;
  esac

  asset_name="helm-docs_${version}_${os}_${arch}.tar.gz"
  asset_url="$({
    printf '%s' "${release_json}" | jq -r --arg name "${asset_name}" '.assets[] | select(.name == $name) | .browser_download_url'
  })"

  if [[ -z "${asset_url}" || "${asset_url}" == "null" ]]; then
    echo "Could not resolve helm-docs download URL for asset ${asset_name}." >&2
    exit 1
  fi

  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' RETURN

  curl -fsSL "${asset_url}" -o "${tmp_dir}/helm-docs.tar.gz"
  tar -xzf "${tmp_dir}/helm-docs.tar.gz" -C "${tmp_dir}"
  install -m 0755 "${tmp_dir}/helm-docs" "${BIN_PATH}"
}

current_version=""
if [[ -x "${BIN_PATH}" ]]; then
  current_version="$(${BIN_PATH} --version | sed -E 's/.*version[[:space:]]+([0-9]+\.[0-9]+\.[0-9]+).*/\1/' || true)"
fi

latest_version="$(curl -fsSL https://api.github.com/repos/norwoodj/helm-docs/releases/latest | jq -r '.tag_name | ltrimstr("v")')"
if [[ ! -x "${BIN_PATH}" || "${current_version}" != "${latest_version}" ]]; then
  install_latest_helm_docs
fi

run_helm_docs() {
  local root="$1"
  "${BIN_PATH}" \
    --chart-search-root "${root}"
}

if [[ "${CHECK_MODE}" -eq 1 ]]; then
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' EXIT

  cp -R "${CHART_SEARCH_ROOT}" "${tmp_dir}/helm"
  run_helm_docs "${tmp_dir}/helm"

  if ! diff -u "${CHART_PATH}/README.md" "${tmp_dir}/helm/${CHART_NAME}/README.md" >/dev/null; then
    echo "Helm docs are out of date: ${CHART_PATH}/README.md" >&2
    diff -u "${CHART_PATH}/README.md" "${tmp_dir}/helm/${CHART_NAME}/README.md" || true
    exit 1
  fi

  echo "Helm docs are up to date."
  exit 0
fi

run_helm_docs "${CHART_SEARCH_ROOT}"
echo "Helm docs generated for ${CHART_PATH}."

# Keep the docs site's generated values table in sync.
# Only runs when the docs app exists — safe to skip in CI environments that don't build docs.
DOCS_APP="${REPO_ROOT}/apps/docs"
if [[ -d "${DOCS_APP}" ]]; then
  node "${REPO_ROOT}/scripts/extract-helm-values.mjs"
fi
