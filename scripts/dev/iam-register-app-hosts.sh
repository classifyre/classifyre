#!/usr/bin/env bash
# Runs INSIDE the identity pod (`scripts/dev/web-iam.sh` pipes it to `bash -c`):
# makes the classifyre-web client accept sign-in from localhost and from every
# host given as an argument. The admin password comes in on the first line of
# stdin, so it never appears in a process list outside the pod.
set -euo pipefail
read -r admin_password
KC=/opt/keycloak/bin/kcadm.sh
$KC config credentials --server http://localhost:8080/iam --realm master \
  --user admin --password "$admin_password" >/dev/null
id=$($KC get clients -r classifyre -q clientId=classifyre-web --fields id --format csv --noquotes)

redirects='"http://localhost:3000/auth/callback"'
origins='"http://localhost:3000"'
logout='http://localhost:3000/*'
for host in "$@"; do
  redirects="$redirects,\"http://$host:3000/auth/callback\""
  origins="$origins,\"http://$host:3000\""
  logout="$logout##http://$host:3000/*"
done
$KC update "clients/$id" -r classifyre \
  -s "redirectUris=[$redirects]" \
  -s "webOrigins=[$origins]" \
  -s "attributes.\"post.logout.redirect.uris\"=$logout"
echo "registered: $*"
