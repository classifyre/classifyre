#!/usr/bin/env bash
# Creates the Kestrel & Finch Journeys organization (a Classifyre tenant), its
# groups and its people in the dev identity server. Safe to rerun.
#
#   development/kestrel-finch/setup/iam.sh
#
# Every person signs in with KF_PASSWORD (default below): a local demo value.
set -euo pipefail
NS=${NS:-classifyre-dev}
RELEASE=${RELEASE:-classifyre}
KF_PASSWORD=${KF_PASSWORD:-Kestrel-Demo-2026}
ADMIN_PW=$(kubectl -n "$NS" get secret "$RELEASE-iam" -o jsonpath='{.data.admin-password}' | base64 -d)

kubectl -n "$NS" exec -i "deploy/$RELEASE-iam" -c iam -- env HOME=/tmp ADMIN_PW="$ADMIN_PW" PW="$KF_PASSWORD" bash -s <<'EOF'
set -euo pipefail
K=/opt/keycloak/bin/kcadm.sh
R=classifyre
$K config credentials --server http://localhost:8080/iam --realm master --user admin --password "$ADMIN_PW" >/dev/null

fid() {  # fid <path> <field> <value>
  local id val
  while IFS=, read -r id val; do
    if [ "$val" = "$3" ]; then echo "$id"; return; fi
  done < <($K get "$1" -r "$R" --fields "id,$2" --format csv --noquotes 2>/dev/null)
}

ORG=$(fid organizations alias kestrel-finch)
if [ -z "$ORG" ]; then
  $K create organizations -r $R -s "name=Kestrel & Finch Journeys" -s alias=kestrel-finch -s enabled=true \
    -s 'domains=[{"name":"kestrelfinch.example","verified":false}]' >/dev/null
  ORG=$(fid organizations alias kestrel-finch)
fi

group() {  # group <parent id or ""> <name>
  local path="organizations/$ORG/groups" id
  [ -n "$1" ] && path="organizations/$ORG/groups/$1/children"
  id=$(fid "$path" name "$2")
  if [ -z "$id" ]; then
    $K create "$path" -r $R -s "name=$2" >/dev/null
    id=$(fid "$path" name "$2")
  fi
  echo "$id"
}

user() {  # user <username> <first> <last> <group id>
  local id
  id=$($K get users -r $R -q "username=$1" -q exact=true --fields id --format csv --noquotes | head -1)
  if [ -z "$id" ]; then
    id=$($K create users -r $R -s "username=$1" -s enabled=true -s "firstName=$2" -s "lastName=$3" \
      -s "email=$1@kestrelfinch.example" -s emailVerified=true -i)
  fi
  $K set-password -r $R --userid "$id" --new-password "$PW" >/dev/null
  $K create "organizations/$ORG/members" -r $R -b "\"$id\"" >/dev/null 2>&1 || true
  $K update "organizations/$ORG/groups/$4/members/$id" -r $R -b '{}' >/dev/null 2>&1
  echo "  $1 -> $id"
}

ADMINS=$(group "" admins)
PLATFORM=$(group "" data-platform)
PRIVACY=$(group "" privacy-office)
SALES=$(group "" sales)
DACH=$(group "$SALES" sales-dach)
NORDICS=$(group "$SALES" sales-nordics)
MARKETING=$(group "" marketing)
SUPPORT=$(group "" customer-care)
FINANCE=$(group "" finance)
BI=$(group "" bi-analysts)
AGENCY=$(group "" agency-northlight)

echo "org kestrel-finch: $ORG"
user ines.kovac Ines Kovač "$ADMINS"
user tomasz.wierzbicki Tomasz Wierzbicki "$PLATFORM"
user henrike.sauer Henrike Sauer "$PRIVACY"
user lukas.brandner Lukas Brandner "$DACH"
user sigrid.halvorsen Sigrid Halvorsen "$NORDICS"
user amelie.fontaine Amélie Fontaine "$MARKETING"
user kwame.mensah Kwame Mensah "$SUPPORT"
user olga.lindqvist Olga Lindqvist "$FINANCE"
user ravi.iyer Ravi Iyer "$BI"
user jonas.eklund Jonas Eklund "$AGENCY"
EOF
