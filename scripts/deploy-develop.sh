#!/usr/bin/env bash
# Deploy the develop Helm release (or another release based on the develop VPS values).
#
# Defaults:
#   - kubeconfig: ~/.kube/config-classifyre-vps
#   - namespace: classifyre-develop
#   - release: same as namespace
#   - image tag: develop
#   - demo mode: true
#
# Usage:
#   ./scripts/deploy-develop.sh
#   ./scripts/deploy-develop.sh feat-my-pr
#   ./scripts/deploy-develop.sh --demo-mode false
#   ./scripts/deploy-develop.sh --namespace my-ns --values /tmp/override.yaml

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-develop.sh [image-tag]
  ./scripts/deploy-develop.sh [options]

Options:
  -t, --image-tag TAG       Docker tag to deploy. Default: develop
  -n, --namespace NAME      Kubernetes namespace. Default: classifyre-develop
  -r, --release NAME        Helm release name. Default: same as namespace
  -f, --values FILE         Extra Helm values file. Can be passed multiple times.
      --base-values FILE    Base values file. Default: ./helm/classifyre/values-vps-develop.yaml
      --demo-mode BOOL      Set api.env.DEMO_MODE to true or false. Default: true
      --timeout DURATION    Helm and rollout timeout. Default: 15m
  -h, --help                Show this help

Examples:
  ./scripts/deploy-develop.sh
  ./scripts/deploy-develop.sh feat-my-pr
  ./scripts/deploy-develop.sh -t develop --demo-mode false
  ./scripts/deploy-develop.sh -n classifyre-develop -f /tmp/override.yaml
EOF
}

require_arg() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "${value}" || "${value}" == -* ]]; then
    echo "Error: ${flag} requires a value." >&2
    exit 1
  fi
}

normalize_bool() {
  local raw
  raw="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "${raw}" in
    true|false)
      printf '%s\n' "${raw}"
      ;;
    *)
      echo "Error: expected true or false, got '${1}'." >&2
      exit 1
      ;;
  esac
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

IMAGE_TAG="develop"
HELM_NAMESPACE="classifyre-develop"
HELM_RELEASE_NAME=""
BASE_VALUES_FILE="./helm/classifyre/values-vps-develop.yaml"
DEMO_MODE="true"
DEPLOY_TIMEOUT="15m"
DOCKER_NAMESPACE="${DOCKER_NAMESPACE:-classifyre}"
EXTRA_VALUES_FILES=()
POSITIONAL_IMAGE_TAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--image-tag)
      require_arg "$1" "${2:-}"
      IMAGE_TAG="$2"
      shift 2
      ;;
    -n|--namespace)
      require_arg "$1" "${2:-}"
      HELM_NAMESPACE="$2"
      shift 2
      ;;
    -r|--release)
      require_arg "$1" "${2:-}"
      HELM_RELEASE_NAME="$2"
      shift 2
      ;;
    -f|--values)
      require_arg "$1" "${2:-}"
      EXTRA_VALUES_FILES+=("$2")
      shift 2
      ;;
    --base-values)
      require_arg "$1" "${2:-}"
      BASE_VALUES_FILE="$2"
      shift 2
      ;;
    --demo-mode)
      require_arg "$1" "${2:-}"
      DEMO_MODE="$(normalize_bool "$2")"
      shift 2
      ;;
    --timeout)
      require_arg "$1" "${2:-}"
      DEPLOY_TIMEOUT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Error: unknown option '$1'." >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -n "${POSITIONAL_IMAGE_TAG}" ]]; then
        echo "Error: only one positional image tag is supported." >&2
        usage >&2
        exit 1
      fi
      POSITIONAL_IMAGE_TAG="$1"
      shift
      ;;
  esac
done

if [[ $# -gt 0 ]]; then
  echo "Error: unexpected arguments: $*" >&2
  usage >&2
  exit 1
fi

if [[ -n "${POSITIONAL_IMAGE_TAG}" ]]; then
  IMAGE_TAG="${POSITIONAL_IMAGE_TAG}"
fi

if [[ -z "${HELM_RELEASE_NAME}" ]]; then
  HELM_RELEASE_NAME="${HELM_NAMESPACE}"
fi

if [[ ! -f "${BASE_VALUES_FILE}" ]]; then
  echo "Error: base values file not found: ${BASE_VALUES_FILE}" >&2
  exit 1
fi

for values_file in "${EXTRA_VALUES_FILES[@]+"${EXTRA_VALUES_FILES[@]}"}"; do
  if [[ ! -f "${values_file}" ]]; then
    echo "Error: values file not found: ${values_file}" >&2
    exit 1
  fi
done

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Develop deploy: tag=${IMAGE_TAG}"
echo "║  Namespace: ${HELM_NAMESPACE}"
echo "║  Release: ${HELM_RELEASE_NAME}"
echo "║  Demo mode: ${DEMO_MODE}"
echo "╚══════════════════════════════════════════════════╝"

# ── Resolve kubeconfig ────────────────────────────────────────────────────────
if [[ -z "${KUBECONFIG:-}" ]]; then
  if [[ -f "${HOME}/.kube/config-classifyre-vps" ]]; then
    export KUBECONFIG="${HOME}/.kube/config-classifyre-vps"
    echo "    Using kubeconfig: ${KUBECONFIG}"
  elif [[ -f "${HOME}/.kube/config" ]]; then
    export KUBECONFIG="${HOME}/.kube/config"
    echo "    Using kubeconfig: ${KUBECONFIG}"
  fi
fi

if [[ -z "${KUBECONFIG:-}" ]]; then
  echo "Error: no KUBECONFIG found." >&2
  echo "Set KUBECONFIG=/path/to/config or place config at ~/.kube/config-classifyre-vps" >&2
  exit 1
fi

HELM_VALUES_ARGS=(-f "${BASE_VALUES_FILE}")
for values_file in "${EXTRA_VALUES_FILES[@]+"${EXTRA_VALUES_FILES[@]}"}"; do
  HELM_VALUES_ARGS+=(-f "${values_file}")
done

echo ""
echo "==> Deploying ${HELM_RELEASE_NAME} with Helm..."

helm upgrade --install "${HELM_RELEASE_NAME}" ./helm/classifyre \
  --namespace "${HELM_NAMESPACE}" \
  --create-namespace \
  "${HELM_VALUES_ARGS[@]}" \
  --set api.image.repository="${DOCKER_NAMESPACE}/api" \
  --set api.image.tag="${IMAGE_TAG}" \
  --set api.cliJobs.image.repository="${DOCKER_NAMESPACE}/cli" \
  --set api.cliJobs.image.tag="${IMAGE_TAG}" \
  --set frontend.image.repository="${DOCKER_NAMESPACE}/web" \
  --set frontend.image.tag="${IMAGE_TAG}" \
  --set-string api.env.DEMO_MODE="${DEMO_MODE}" \
  --wait \
  --timeout "${DEPLOY_TIMEOUT}"

echo ""
echo "==> Forcing rollout for every deployment in release ${HELM_RELEASE_NAME}..."
deployments=()
while IFS= read -r line; do
  [[ -n "${line}" ]] && deployments+=("${line}")
done < <(
  kubectl -n "${HELM_NAMESPACE}" get deployments \
    -l "app.kubernetes.io/instance=${HELM_RELEASE_NAME}" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}'
)

if [[ ${#deployments[@]} -eq 0 ]]; then
  echo "Error: no deployments found for release ${HELM_RELEASE_NAME} in namespace ${HELM_NAMESPACE}." >&2
  exit 1
fi

for deployment in "${deployments[@]}"; do
  kubectl -n "${HELM_NAMESPACE}" rollout restart "deployment/${deployment}"
done

for deployment in "${deployments[@]}"; do
  kubectl -n "${HELM_NAMESPACE}" rollout status "deployment/${deployment}" --timeout="${DEPLOY_TIMEOUT}"
done

echo ""
kubectl -n "${HELM_NAMESPACE}" get deploy,pods,svc
helm status "${HELM_RELEASE_NAME}" -n "${HELM_NAMESPACE}"

echo ""
echo "Deploy complete."
echo ""
echo "Port-forward:"
echo "  kubectl -n ${HELM_NAMESPACE} port-forward svc/${HELM_RELEASE_NAME}-web 3101:3100"
echo "  curl http://127.0.0.1:3101/api/ping"
