#!/usr/bin/env bash
# Deploy or update the demo Helm release in the classifyre namespace.
#
# This script is purpose-built for the demo instance (classifyre namespace).
# It uses values-vps.yaml (NodePort 30100) so it never collides with the
# develop instance on NodePort 30101.
#
# Usage:
#   ./scripts/demo-deployment.sh
#   ./scripts/demo-deployment.sh 0.3.2
#   ./scripts/demo-deployment.sh --demo-mode false
#   ./scripts/demo-deployment.sh 0.3.2 --demo-mode false

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/demo-deployment.sh [image-tag]
  ./scripts/demo-deployment.sh [options]

Options:
  -t, --image-tag TAG    Docker tag to deploy. Default: main
      --demo-mode BOOL   Set api.env.DEMO_MODE to true or false. Default: true
      --timeout DURATION Helm and rollout timeout. Default: 15m
  -h, --help             Show this help

Examples:
  # Deploy latest main tag with demo mode ON (default)
  ./scripts/demo-deployment.sh

  # Deploy a specific tag with demo mode ON
  ./scripts/demo-deployment.sh 0.3.2

  # Deploy a specific tag with demo mode OFF
  ./scripts/demo-deployment.sh 0.3.2 --demo-mode false

  # Keep current tag, just toggle demo mode OFF
  ./scripts/demo-deployment.sh --demo-mode false

  # Keep current tag, just toggle demo mode ON
  ./scripts/demo-deployment.sh --demo-mode true
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

# Demo instance defaults
IMAGE_TAG="main"
HELM_NAMESPACE="classifyre"
HELM_RELEASE_NAME="classifyre"
BASE_VALUES_FILE="./helm/classifyre/values-vps.yaml"
DEMO_MODE="true"
DEPLOY_TIMEOUT="15m"
DOCKER_NAMESPACE="${DOCKER_NAMESPACE:-classifyre}"
POSITIONAL_IMAGE_TAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--image-tag)
      require_arg "$1" "${2:-}"
      IMAGE_TAG="$2"
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

if [[ ! -f "${BASE_VALUES_FILE}" ]]; then
  echo "Error: base values file not found: ${BASE_VALUES_FILE}" >&2
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Demo deploy: tag=${IMAGE_TAG}"
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

echo ""
echo "==> Deploying ${HELM_RELEASE_NAME} with Helm..."

helm upgrade --install "${HELM_RELEASE_NAME}" ./helm/classifyre \
  --namespace "${HELM_NAMESPACE}" \
  --create-namespace \
  -f "${BASE_VALUES_FILE}" \
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
echo "  kubectl -n ${HELM_NAMESPACE} port-forward svc/${HELM_RELEASE_NAME}-web 3100:3100"
echo "  curl http://127.0.0.1:3100/api/ping"
