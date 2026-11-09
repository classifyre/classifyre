#!/usr/bin/env bash
# Seeds a release with sign-in for the smoke test (apps/e2e/tests/smoke.spec.ts):
#   - the ConfigMap `classifyre-smoke-fixture`, mounted into scan jobs at
#     /mnt/corpora/smoke by `api.localFolders` (one file with a fake secret);
#   - in the identity server, `smoke-admin` (member of the first tenant's
#     `admins` group) and `smoke-viewer` (member of a new `smoke-viewers`
#     group), with new random passwords; with a public tenant (iam.public),
#     `smoke-publisher` in its `admins` group too;
#   - the Playwright env file with their credentials.
# Idempotent: existing smoke users are replaced.
#
#   NS=classifyre-dev RELEASE=classifyre BASE_URL=http://localhost:3000 scripts/smoke/seed.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NS=${NS:?set NS to the release namespace}
RELEASE=${RELEASE:?set RELEASE to the Helm release}
BASE_URL=${BASE_URL:?set BASE_URL to the URL people open Classifyre at}
TENANT=${SMOKE_TENANT:-default}
PUBLIC=${SMOKE_PUBLIC_TENANT:-public}
OUT=${OUT:-$ROOT/apps/e2e/.env}

kubectl -n "$NS" create configmap classifyre-smoke-fixture \
  --from-file="$ROOT/docker/fixtures/smoke/deploy-notes.txt" \
  --from-file="$ROOT/docker/fixtures/smoke/orders.csv" \
  --dry-run=client -o yaml | kubectl -n "$NS" apply -f - >/dev/null

ADMIN_PW=$(kubectl -n "$NS" get secret "$RELEASE-iam" -o jsonpath='{.data.admin-password}' | base64 -d)
SMOKE_ADMIN_PASSWORD=$(openssl rand -hex 16)
SMOKE_VIEWER_PASSWORD=$(openssl rand -hex 16)
SMOKE_PUBLISHER_PASSWORD=$(openssl rand -hex 16)

kubectl -n "$NS" exec -i "deploy/$RELEASE-iam" -c iam -- env \
  ADMIN_PW="$ADMIN_PW" TENANT="$TENANT" PUBLIC="$PUBLIC" \
  A_PW="$SMOKE_ADMIN_PASSWORD" V_PW="$SMOKE_VIEWER_PASSWORD" \
  P_PW="$SMOKE_PUBLISHER_PASSWORD" bash -s > "$OUT.kc" <<'KC'
set -euo pipefail
K=/opt/keycloak/bin/kcadm.sh
R=classifyre
$K config credentials --server http://localhost:8080/iam --realm master --user admin --password "$ADMIN_PW" >/dev/null
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
person() { # person <username> <password> <group id> [organization id]
  local old id org=${4:-$ORG}
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
# The public tenant, when the release has one: its editor publishes a workspace.
PUBLIC_ORG=$({ $K get organizations -r $R --fields id,alias --format csv --noquotes 2>/dev/null || true; } \
  | { grep ",$PUBLIC\$" || true; } | cut -d, -f1)
if [ -n "$PUBLIC_ORG" ] && [ "$PUBLIC" != "$TENANT" ]; then
  PUBLIC_ADMINS=$($K get "organizations/$PUBLIC_ORG/groups" -r $R --fields id,name --format csv --noquotes \
    | { grep ',admins$' || true; } | cut -d, -f1 | head -1)
  person smoke-publisher "$P_PW" "$PUBLIC_ADMINS" "$PUBLIC_ORG"
  echo "public=yes"
fi
KC
HAS_PUBLIC=$(grep -c '^public=yes' "$OUT.kc" || true)
rm -f "$OUT.kc"

umask 077
cat > "$OUT" <<ENV
BASE_URL=$BASE_URL
SMOKE_ADMIN_USER=smoke-admin
SMOKE_ADMIN_PASSWORD=$SMOKE_ADMIN_PASSWORD
SMOKE_VIEWER_USER=smoke-viewer
SMOKE_VIEWER_PASSWORD=$SMOKE_VIEWER_PASSWORD
SMOKE_VIEWERS_GROUP=/smoke-viewers
SMOKE_FOLDER=/mnt/corpora/smoke
ENV
if [ "$HAS_PUBLIC" = "1" ]; then
  cat >> "$OUT" <<ENV
SMOKE_PUBLISHER_USER=smoke-publisher
SMOKE_PUBLISHER_PASSWORD=$SMOKE_PUBLISHER_PASSWORD
ENV
fi
echo "Seeded $RELEASE in $NS; Playwright settings in $OUT"
