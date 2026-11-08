#!/usr/bin/env bash
# Removes what seed.sh made, for a release that stays (the local dev stack).
# A CI release is destroyed instead (destroy.sh).
#
#   NS=classifyre-dev RELEASE=classifyre scripts/smoke/teardown.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NS=${NS:?set NS to the release namespace}
RELEASE=${RELEASE:?set RELEASE to the Helm release}
TENANT=${SMOKE_TENANT:-default}

ADMIN_PW=$(kubectl -n "$NS" get secret "$RELEASE-iam" -o jsonpath='{.data.admin-password}' | base64 -d)
kubectl -n "$NS" exec -i "deploy/$RELEASE-iam" -c iam -- env ADMIN_PW="$ADMIN_PW" TENANT="$TENANT" bash -s <<'KC'
K=/opt/keycloak/bin/kcadm.sh
R=classifyre
$K config credentials --server http://localhost:8080/iam --realm master --user admin --password "$ADMIN_PW" >/dev/null
for name in smoke-admin smoke-viewer smoke-publisher; do
  id=$($K get users -r $R -q "username=$name" -q exact=true --fields id --format csv --noquotes | head -1)
  [ -z "$id" ] || $K delete "users/$id" -r $R
done
ORG=$($K get organizations -r $R --fields id,alias --format csv --noquotes | grep ",$TENANT\$" | cut -d, -f1)
VIEWERS=$($K get "organizations/$ORG/groups" -r $R --fields id,name --format csv --noquotes | grep ',smoke-viewers$' | cut -d, -f1 | head -1)
[ -z "$VIEWERS" ] || $K delete "organizations/$ORG/groups/$VIEWERS" -r $R
KC
kubectl -n "$NS" delete configmap classifyre-smoke-fixture --ignore-not-found >/dev/null
rm -f "$ROOT/apps/e2e/.env"
echo "Removed the smoke users, group and folder from $RELEASE in $NS"
