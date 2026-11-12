#!/usr/bin/env bash
# Builds classifyre/cli:dev-odbc (unixODBC + the PostgreSQL driver + pyodbc on top
# of the dev stack's CLI image) and points the dev stack's scan jobs at it.
#
# `skaffold dev` resets the job template ConfigMap to classifyre/cli:latest on
# every helm upgrade; run this again after one (or once the published image has
# ODBC, and you no longer need it).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NS=${NS:-classifyre-dev}
CLUSTER=${CLUSTER:-classifyre}
TAG=${TAG:-classifyre/cli:dev-odbc}

docker build --pull -f "$ROOT/development/odbc-smoke/Dockerfile.cli" -t "$TAG" "$ROOT/development/odbc-smoke"
k3d image import "$TAG" -c "$CLUSTER"

cm=classifyre-api-cli-job-template
current=$(kubectl -n "$NS" get cm "$cm" -o jsonpath='{.data.job-template\.json}')
patched=$(printf '%s' "$current" | python3 -c "
import json, sys
tag = sys.argv[1]
t = json.load(sys.stdin)
for c in t['spec']['template']['spec']['containers']:
    c['image'] = tag
    c['imagePullPolicy'] = 'IfNotPresent'
print(json.dumps(t))" "$TAG")
kubectl -n "$NS" patch cm "$cm" --type merge \
  -p "$(python3 -c "import json,sys; print(json.dumps({'data': {'job-template.json': sys.argv[1]}}))" "$patched")"
# The API caches the template in memory.
kubectl -n "$NS" rollout restart deploy/classifyre-api deploy/classifyre-worker
echo "Scan and query jobs now run $TAG. Wait for the API pods to roll before testing."
