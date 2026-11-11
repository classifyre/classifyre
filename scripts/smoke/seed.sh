#!/usr/bin/env bash
# Seeds an install for the smoke test (apps/e2e/tests/smoke.spec.ts), the same
# for a Helm release and the all-in-one Docker image:
#   - the folder with one file holding a fake secret: on Kubernetes the
#     ConfigMap `classifyre-smoke-fixture`, mounted into scan jobs at
#     /mnt/corpora/smoke by `api.localFolders`; in Docker docker/scripts/smoke.sh
#     mounts docker/fixtures/smoke at /data/smoke;
#   - in the identity server, `smoke-admin` (member of the first tenant's
#     `admins` group) and `smoke-viewer` (member of a new `smoke-viewers`
#     group), with new random passwords;
#   - the Playwright env file with their credentials.
# Idempotent: existing smoke users are replaced.
#
#   NS=classifyre-dev RELEASE=classifyre BASE_URL=http://localhost:3000 scripts/smoke/seed.sh
#   SMOKE_TARGET=docker CONTAINER=classifyre-smoke BASE_URL=http://localhost:3300 scripts/smoke/seed.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TARGET=${SMOKE_TARGET:-k8s}
BASE_URL=${BASE_URL:?set BASE_URL to the URL people open Classifyre at}
TENANT=${SMOKE_TENANT:-default}
OUT=${OUT:-$ROOT/apps/e2e/.env}

case "$TARGET" in
  k8s)
    NS=${NS:?set NS to the release namespace}
    RELEASE=${RELEASE:?set RELEASE to the Helm release}
    kubectl -n "$NS" create configmap classifyre-smoke-fixture \
      --from-file="$ROOT/docker/fixtures/smoke/deploy-notes.txt" \
      --from-file="$ROOT/docker/fixtures/smoke/orders.csv" \
      --dry-run=client -o yaml | kubectl -n "$NS" apply -f - >/dev/null
    ADMIN_USER=admin
    ADMIN_PW=$(kubectl -n "$NS" get secret "$RELEASE-iam" -o jsonpath='{.data.admin-password}' | base64 -d)
    KC_URL=http://localhost:8080/iam
    FOLDER=/mnt/corpora/smoke
    in_iam() { kubectl -n "$NS" exec -i "deploy/$RELEASE-iam" -c iam -- "$@"; }
    ;;
  docker)
    CONTAINER=${CONTAINER:?set CONTAINER to the all-in-one container}
    ADMIN_USER=${CLASSIFYRE_ADMIN_USER:-classifyre}
    ADMIN_PW=${CLASSIFYRE_ADMIN_PASSWORD:-classifyre}
    KC_URL=http://127.0.0.1:8180/iam
    FOLDER=/data/smoke
    in_iam() { docker exec -i -e HOME=/tmp "$CONTAINER" "$@"; }
    ;;
  *) echo "SMOKE_TARGET is k8s or docker, not $TARGET" >&2; exit 1 ;;
esac

SMOKE_ADMIN_PASSWORD=$(openssl rand -hex 16)
SMOKE_VIEWER_PASSWORD=$(openssl rand -hex 16)

in_iam env \
  KC_URL="$KC_URL" ADMIN_USER="$ADMIN_USER" ADMIN_PW="$ADMIN_PW" TENANT="$TENANT" \
  A_PW="$SMOKE_ADMIN_PASSWORD" V_PW="$SMOKE_VIEWER_PASSWORD" \
  bash -s > "$OUT.kc" <<'KC'
set -euo pipefail
K=/opt/keycloak/bin/kcadm.sh
R=classifyre
# The identity server may still be starting (and the Helm realm setup job is
# not waited for): retry signing in for up to ten minutes.
for _ in $(seq 1 60); do
  $K config credentials --server "$KC_URL" --realm master --user "$ADMIN_USER" --password "$ADMIN_PW" >/dev/null 2>&1 && break
  sleep 10
done
$K config credentials --server "$KC_URL" --realm master --user "$ADMIN_USER" --password "$ADMIN_PW" >/dev/null
# The realm setup job runs next to the release and Helm does not wait for it:
# wait for the realm and its first organization.
ORG=""
for _ in $(seq 1 60); do
  ORG=$({ $K get organizations -r $R --fields id,alias --format csv --noquotes 2>/dev/null || true; } \
    | { grep ",$TENANT\$" || true; } | cut -d, -f1)
  [ -z "$ORG" ] || break
  sleep 10
done
[ -n "$ORG" ] || { echo "no organization '$TENANT' in realm $R after 10 minutes" >&2; exit 1; }
group_id() { $K get "organizations/$ORG/groups" -r $R --fields id,name --format csv --noquotes | { grep ",$1\$" || true; } | cut -d, -f1 | head -1; }
ADMINS=""
for _ in $(seq 1 30); do
  ADMINS=$(group_id admins)
  [ -z "$ADMINS" ] || break
  sleep 10
done
[ -n "$ADMINS" ] || { echo "organization '$TENANT' has no admins group" >&2; exit 1; }
VIEWERS=$(group_id smoke-viewers)
[ -n "$VIEWERS" ] || VIEWERS=$($K create "organizations/$ORG/groups" -r $R -s name=smoke-viewers -i)
person() { # person <username> <password> <group id>
  local old id org=$ORG
  old=$($K get users -r $R -q "username=$1" -q exact=true --fields id --format csv --noquotes | head -1)
  [ -z "$old" ] || $K delete "users/$old" -r $R
  id=$($K create users -r $R -s "username=$1" -s "email=$1@example.test" -s firstName=Smoke \
    -s "lastName=$1" -s enabled=true -s emailVerified=true -i)
  $K set-password -r $R --userid "$id" --new-password "$2"
  $K create "organizations/$org/members" -r $R -b "\"$id\"" >/dev/null
  $K update "organizations/$org/groups/$3/members/$id" -r $R -b '{}' >/dev/null
}
person smoke-admin "$A_PW" "$ADMINS"
person smoke-viewer "$V_PW" "$VIEWERS"
KC
rm -f "$OUT.kc"

umask 077
cat > "$OUT" <<ENV
BASE_URL=$BASE_URL
SMOKE_ADMIN_USER=smoke-admin
SMOKE_ADMIN_PASSWORD=$SMOKE_ADMIN_PASSWORD
SMOKE_VIEWER_USER=smoke-viewer
SMOKE_VIEWER_PASSWORD=$SMOKE_VIEWER_PASSWORD
SMOKE_VIEWERS_GROUP=/smoke-viewers
SMOKE_FOLDER=$FOLDER
ENV
echo "Seeded the $TARGET install; Playwright settings in $OUT"
