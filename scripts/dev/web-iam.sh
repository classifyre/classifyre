#!/usr/bin/env bash
# Runs the web app locally (http://localhost:3000) with sign-in, against the
# dev stack started with `CLASSIFYRE_IAM=true ./scripts/dev/start.sh`. The web
# client's secret is read from the cluster, so nothing is written to disk.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NS=${CLASSIFYRE_NAMESPACE:-classifyre-dev}

secret=$(kubectl --context k3d-classifyre -n "$NS" get secret classifyre-iam \
  -o jsonpath='{.data.web-client-secret}' 2>/dev/null | base64 -d || true)
if [ -z "$secret" ]; then
  echo "No classifyre-iam Secret in $NS: start the dev stack with CLASSIFYRE_IAM=true first." >&2
  exit 1
fi

cd "$ROOT/apps/web"
export IAM_ENABLED=true
export IAM_REALM=classifyre
# The identity server is port-forwarded by skaffold; the browser and this
# server both reach it there.
export IAM_ISSUER_URL=http://localhost:8180/iam/realms/classifyre
export IAM_INTERNAL_URL=http://localhost:8180/iam
export IAM_APP_URL=http://localhost:3000
export IAM_WEB_CLIENT_ID=classifyre-web
export IAM_WEB_CLIENT_SECRET="$secret"
exec bun dev
