#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

for required_command in curl docker k3d kubectl helm; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Missing required command: ${required_command}" >&2
    exit 1
  fi
done

# Resolve the latest stable tag on every cluster creation instead of allowing a
# hard-coded minimum version to become stale.
k3d_version="$(k3d version | awk '/k3d version/ {print $3}')"
k3d_latest_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' \
  https://github.com/k3d-io/k3d/releases/latest)"
k3d_latest_version="${k3d_latest_url##*/}"
if [[ -z "${k3d_version}" || -z "${k3d_latest_version}" || "${k3d_version}" != "${k3d_latest_version}" ]]; then
  echo "Latest stable k3d ${k3d_latest_version:-could not be determined} is required (found ${k3d_version:-unknown})." >&2
  echo "Upgrade k3d with your package manager before creating the cluster." >&2
  exit 1
fi

if ! k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -qx classifyre; then
  k3d cluster create \
    --config "${repo_root}/deploy/dev/k3d.yaml" \
    --volume "${repo_root}:/var/lib/classifyre/source@server:0"
fi

mounted_source="$(
  docker inspect k3d-classifyre-server-0 \
    --format '{{range .Mounts}}{{if eq .Destination "/var/lib/classifyre/source"}}{{.Source}}{{end}}{{end}}'
)"
if [[ "${mounted_source}" != "${repo_root}" ]]; then
  echo "The existing k3d cluster was created without this checkout mounted." >&2
  echo "Run ./scripts/dev/delete-cluster.sh, then retry cluster creation." >&2
  exit 1
fi

kubectl config use-context k3d-classifyre

# These directories live in the k3d node, not in the host checkout. They keep
# Bun dependencies and framework caches warm across pod restarts while source
# remains a read-only mount in the application containers.
docker exec k3d-classifyre-server-0 sh -ec '
  mkdir -p \
    /var/lib/classifyre/cache/api/root-node-modules \
    /var/lib/classifyre/cache/api/api-node-modules \
    /var/lib/classifyre/cache/api/schemas-node-modules \
    /var/lib/classifyre/cache/api/eslint-node-modules \
    /var/lib/classifyre/cache/api/typescript-config-node-modules \
    /var/lib/classifyre/cache/api/bun \
    /var/lib/classifyre/cache/web/root-node-modules \
    /var/lib/classifyre/cache/web/web-node-modules \
    /var/lib/classifyre/cache/web/api-client-node-modules \
    /var/lib/classifyre/cache/web/schemas-node-modules \
    /var/lib/classifyre/cache/web/ui-node-modules \
    /var/lib/classifyre/cache/web/eslint-node-modules \
    /var/lib/classifyre/cache/web/typescript-config-node-modules \
    /var/lib/classifyre/cache/web/bun \
    /var/lib/classifyre/cache/web/next
  touch /var/lib/classifyre/cache/web/next-env.d.ts
  chown -R 10001:10001 /var/lib/classifyre/cache
'

# Keep the local ingress implementation aligned with the chart's existing
# nginx.ingress.kubernetes.io annotations. This is cluster infrastructure, so
# it is installed once rather than on every Skaffold run.
helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.allowSnippetAnnotations=true \
  --set controller.config.annotations-risk-level=Critical \
  --set controller.service.type=LoadBalancer \
  --set controller.ingressClassResource.default=true \
  --wait \
  --timeout 5m

kubectl wait \
  --namespace ingress-nginx \
  --for=condition=Available \
  deployment/ingress-nginx-controller \
  --timeout=5m

echo "k3d cluster ready: k3d-classifyre"
echo "Ingress: http://classifyre.localhost:8080"
echo "Source: ${repo_root} -> /var/lib/classifyre/source"
