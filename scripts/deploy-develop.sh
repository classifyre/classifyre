#!/usr/bin/env bash
# Deploy the develop Helm release to the classifyre-develop namespace.
#
# Uses the :develop Docker image tag (built automatically when code is
# pushed to the 'develop' branch by the CI workflow).
#
# Prerequisites:
#   brew install kubectl helm
#   KUBECONFIG pointing at the k3s cluster (or ~/.kube/config-classifyre-vps)
#
# Usage:
#   ./scripts/deploy-develop.sh              # deploy :develop tag
#   ./scripts/deploy-develop.sh feat-my-pr  # deploy a specific image tag

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

IMAGE_TAG="${1:-develop}"

HELM_RELEASE_NAME="classifyre-develop"
HELM_NAMESPACE="classifyre-develop"
HELM_VALUES_FILE="./helm/classifyre/values-vps-develop.yaml"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Staging deploy: tag=${IMAGE_TAG}"
echo "║  Namespace: ${HELM_NAMESPACE}"
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
echo "==> Deploying classifyre-develop (tag: ${IMAGE_TAG})..."

helm upgrade --install "${HELM_RELEASE_NAME}" ./helm/classifyre \
  --namespace "${HELM_NAMESPACE}" \
  --create-namespace \
  -f "${HELM_VALUES_FILE}" \
  --set api.image.tag="${IMAGE_TAG}" \
  --set api.cliJobs.image.tag="${IMAGE_TAG}" \
  --set frontend.image.tag="${IMAGE_TAG}" \
  --wait \
  --timeout 15m

echo ""
kubectl -n "${HELM_NAMESPACE}" get deploy,pods,svc
helm status "${HELM_RELEASE_NAME}" -n "${HELM_NAMESPACE}"

echo ""
echo "✅  Staging deploy complete!"
echo ""
echo "Test via port-forward:"
echo "  kubectl -n ${HELM_NAMESPACE} port-forward svc/classifyre-develop-web 3101:3100"
echo "  curl http://127.0.0.1:3101/api/ping"
echo ""
echo "When port 30101 is open on the VPS:"
echo "  http://<vps-ip>:30101"
