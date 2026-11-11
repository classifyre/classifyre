#!/usr/bin/env bash
# Runs the web app locally (http://localhost:3000) against the dev stack
# (`./scripts/dev/start.sh`). Sign-in is always on, so the web app needs the
# identity server's settings; the web client's secret is read from the
# cluster, so nothing is written to disk.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NS=${CLASSIFYRE_NAMESPACE:-classifyre-dev}

secret=$(kubectl --context k3d-classifyre -n "$NS" get secret classifyre-iam \
  -o jsonpath='{.data.web-client-secret}' 2>/dev/null | base64 -d || true)
if [ -z "$secret" ]; then
  echo "No classifyre-iam Secret in $NS: start the dev stack first (./scripts/dev/start.sh)." >&2
  exit 1
fi

cd "$ROOT/apps/web"
export IAM_REALM=classifyre
export IAM_APP_URL=http://localhost:3000
# The issuer is always the app's own address plus the proxied `/iam` path —
# nothing separate to configure. Token calls go over the skaffold
# port-forward instead, since the in-cluster DNS name only resolves
# inside the cluster.
export IAM_ISSUER_URL="$IAM_APP_URL/iam/realms/$IAM_REALM"
export IAM_INTERNAL_URL=http://localhost:8280/iam
export IAM_WEB_CLIENT_ID=classifyre-web
export IAM_WEB_CLIENT_SECRET="$secret"
# Same settings as the API's (the dev values): which identity consoles the
# `/iam` proxy forwards.
api_env() {
  kubectl --context k3d-classifyre -n "$NS" get deploy classifyre-api \
    -o jsonpath="{.spec.template.spec.containers[0].env[?(@.name==\"$1\")].value}" 2>/dev/null || true
}
IAM_REALM_CONSOLE=$(api_env IAM_REALM_CONSOLE)
IAM_EXPOSE_ADMIN_CONSOLE=$(api_env IAM_EXPOSE_ADMIN_CONSOLE)
export IAM_REALM_CONSOLE IAM_EXPOSE_ADMIN_CONSOLE
exec bun dev
