#!/usr/bin/env bash
# Destroys a smoke release with its database, so the next run starts fresh:
# the Helm release, its PersistentVolumeClaims (PostgreSQL holds the open,
# control, tenant and identity server databases) and the seeded folder. The
# kept Secrets (`<release>-iam`, the PostgreSQL credentials) stay, so a fresh
# install finds matching passwords.
#
#   NS=classifyre-develop RELEASE=classifyre-develop scripts/smoke/destroy.sh
set -euo pipefail

NS=${NS:?set NS to the release namespace}
RELEASE=${RELEASE:?set RELEASE to the Helm release}

helm uninstall "$RELEASE" -n "$NS" --wait --timeout 10m 2>/dev/null || true
kubectl -n "$NS" delete pvc -l "app.kubernetes.io/instance=$RELEASE" --wait=true --timeout=5m --ignore-not-found
kubectl -n "$NS" delete jobs -l "app.kubernetes.io/instance=$RELEASE" --ignore-not-found >/dev/null 2>&1 || true
# Scan jobs the API started carry its own label, not the release's; one still
# Pending would start later against a release that is gone.
kubectl -n "$NS" delete jobs -l app.kubernetes.io/managed-by=classifyre-api \
  --cascade=foreground --ignore-not-found --wait=true --timeout=2m >/dev/null 2>&1 || true
kubectl -n "$NS" delete configmap classifyre-smoke-fixture --ignore-not-found >/dev/null
left=$(kubectl -n "$NS" get pvc -l "app.kubernetes.io/instance=$RELEASE" -o name | wc -l | tr -d ' ')
[ "$left" = "0" ] || { echo "PVCs of $RELEASE are still there" >&2; exit 1; }
jobs=$(kubectl -n "$NS" get jobs -l app.kubernetes.io/managed-by=classifyre-api -o name | wc -l | tr -d ' ')
[ "$jobs" = "0" ] || { echo "Scan jobs of $RELEASE are still there" >&2; exit 1; }
echo "Destroyed $RELEASE in $NS with its database"
