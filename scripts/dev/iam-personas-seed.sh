#!/usr/bin/env bash
# Seeds the persona realm for scripts/dev/iam-personas.sh. Runs INSIDE the
# identity server pod (kcadm.sh from its own image), on a throwaway release
# only: it adds a password-grant test client and invented test users.
set -euo pipefail

KC=/opt/keycloak/bin/kcadm.sh
R=classifyre
"$KC" config credentials --server http://localhost:8080/iam --realm master \
  --user admin --password "$ADMIN_PW" >/dev/null

fid() {
  local id val
  while IFS=, read -r id val; do
    if [ "$val" = "$3" ]; then echo "$id"; return; fi
  done < <("$KC" get "$1" -r "$R" --fields "id,$2" --format csv --noquotes 2>/dev/null)
}

# A client that allows password sign-in, so the checks can get tokens without
# a browser. Throwaway realms only.
if [ -z "$(fid clients clientId persona-test)" ]; then
  "$KC" create clients -r "$R" -s clientId=persona-test -s publicClient=true \
    -s directAccessGrantsEnabled=true -s standardFlowEnabled=false \
    -s fullScopeAllowed=false >/dev/null 2>&1
fi
CID=$(fid clients clientId persona-test)
"$KC" update "clients/$CID/default-client-scopes/$(fid client-scopes name classifyre)" -r "$R" >/dev/null 2>&1
"$KC" update "clients/$CID/optional-client-scopes/$(fid client-scopes name organization)" -r "$R" >/dev/null 2>&1 || true

org() {
  local id; id=$(fid organizations alias "$1")
  if [ -z "$id" ]; then
    "$KC" create organizations -r "$R" -s "name=$2" -s "alias=$1" -s enabled=true >/dev/null 2>&1
    id=$(fid organizations alias "$1")
  fi
  echo "$id"
}
group() {
  local org=$1 parent=$2 name=$3 path id
  path="organizations/$org/groups"
  [ -n "$parent" ] && path="organizations/$org/groups/$parent/children"
  id=$(fid "$path" name "$name")
  if [ -z "$id" ]; then
    "$KC" create "$path" -r "$R" -s "name=$name" >/dev/null 2>&1
    id=$(fid "$path" name "$name")
  fi
  echo "$id"
}
user() {
  local name=$1 org=$2 grp=$3 id
  id=$(fid users username "$name")
  if [ -z "$id" ]; then
    "$KC" create users -r "$R" -s "username=$name" -s enabled=true -s "firstName=$4" \
      -s lastName=Persona -s "email=$name@example.test" -s emailVerified=true >/dev/null 2>&1
    id=$(fid users username "$name")
  fi
  "$KC" set-password -r "$R" --userid "$id" --new-password persona-pass-1 >/dev/null 2>&1
  if [ -n "$org" ]; then
    "$KC" create "organizations/$org/members" -r "$R" -b "\"$id\"" >/dev/null 2>&1 || true
  fi
  if [ -n "$grp" ]; then
    "$KC" update "organizations/$org/groups/$grp/members/$id" -r "$R" -b '{}' >/dev/null 2>&1
  fi
  echo "$id"
}

ACME=$(org default Default)
GLOBEX=$(org globex Globex)
FIN=$(group "$ACME" "" finance)
WM=$(group "$ACME" "$FIN" workspace-managers)
AP=$(group "$ACME" "$FIN" ap-team)
SALES=$(group "$ACME" "" sales)
LEGAL=$(group "$ACME" "" legal)
DATA=$(group "$ACME" "" data-engineering)
AUDIT=$(group "$ACME" "" audit)

# The chart's first admin: complete the profile so password sign-in works.
ADMIN=$(fid users username admin)
"$KC" set-password -r "$R" --userid "$ADMIN" --new-password persona-pass-1 >/dev/null 2>&1
"$KC" update "users/$ADMIN" -r "$R" -s firstName=Tenant -s lastName=Admin \
  -s email=admin@example.test -s emailVerified=true -s 'requiredActions=[]' >/dev/null 2>&1

echo "ACME=$ACME GLOBEX=$GLOBEX FIN=$FIN WM=$WM AP=$AP SALES=$SALES LEGAL=$LEGAL DATA=$DATA AUDIT=$AUDIT"
echo "U_CONTROLLER=$(user controller "$ACME" "$FIN" Controller)"
echo "U_MANAGER=$(user manager "$ACME" "$WM" Manager)"
echo "U_INVESTIGATOR=$(user investigator "$ACME" "$AP" Investigator)"
echo "U_SALES=$(user seller "$ACME" "$SALES" Seller)"
echo "U_LEGAL=$(user counsel "$ACME" "$LEGAL" Counsel)"
echo "U_ENGINEER=$(user engineer "$ACME" "$DATA" Engineer)"
echo "U_AUDITOR=$(user auditor "$ACME" "$AUDIT" Auditor)"
echo "U_CONTRACTOR=$(user contractor "$ACME" "" Contractor)"
echo "U_MOVER=$(user mover "$ACME" "$FIN" Mover)"
echo "U_LEAVER=$(user leaver "$ACME" "$FIN" Leaver)"
echo "U_OUTSIDER=$(user outsider "$GLOBEX" "" Outsider)"
# An operator in no tenant (docs/prd/TEN §4.7): manages tenants, sees no workspace.
OPERATOR=$(user operator "" "" Operator)
"$KC" add-roles -r "$R" --uusername operator --rolename classifyre-operator >/dev/null 2>&1
echo "U_OPERATOR=$OPERATOR"
