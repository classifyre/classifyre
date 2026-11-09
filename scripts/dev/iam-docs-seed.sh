#!/usr/bin/env bash
# Makes the invented company of the Access docs (Brightwater Logistics) in the
# dev stack's identity server, for apps/e2e/docs/iam-screenshots.spec.ts:
#
#   organization brightwater with groups admins, finance (accounts-payable,
#   workspace-managers), legal, security, contractors;
#   rduarte (admins, operator), mlindqvist (finance/workspace-managers),
#   tbrenner (finance/accounts-payable), iokafor (legal);
#   kstrand, in no organization; npark, editor (admins) of the public tenant.
#
# Every name is invented. All of them get the password in DOCS_PASSWORD, a
# test value for the local dev stack only. Safe to run again.
#
#   DOCS_PASSWORD=... ./scripts/dev/iam-docs-seed.sh
set -euo pipefail

: "${DOCS_PASSWORD:?set DOCS_PASSWORD, the test password for the docs people}"
CTX=${KUBE_CONTEXT:-k3d-classifyre}
NS=${NAMESPACE:-classifyre-dev}
POD=$(kubectl --context "$CTX" -n "$NS" get pod -l app.kubernetes.io/component=iam -o name | head -1)
ADMIN_PASSWORD=$(kubectl --context "$CTX" -n "$NS" get secret classifyre-iam \
  -o jsonpath='{.data.admin-password}' | base64 -d)

kubectl --context "$CTX" -n "$NS" exec -i "$POD" -c iam -- \
  env KCPW="$ADMIN_PASSWORD" UPW="$DOCS_PASSWORD" bash -s <<'EOF'
set -euo pipefail
KC=/opt/keycloak/bin/kcadm.sh
R=classifyre
"$KC" config credentials --server http://classifyre-iam:8080/iam --realm master \
  --user admin --password "$KCPW" >/dev/null 2>&1

# id,<field> rows of a listing; the first id whose field equals the value.
pick() { local want=$1 id val; while IFS=, read -r id val; do [ "$val" = "$want" ] && { echo "$id"; return; }; done; true; }
org() { "$KC" get organizations -r $R -q first=0 -q max=1000 --fields id,alias --format csv --noquotes | pick "$1"; }
group() { "$KC" get "organizations/$1/groups" -r $R -q first=0 -q max=1000 --fields id,name --format csv --noquotes | pick "$2"; }
child() { "$KC" get "organizations/$1/groups/$2/children" -r $R --fields id,name --format csv --noquotes | pick "$3"; }
user() { "$KC" get users -r $R -q "username=$1" -q exact=true --fields id --format csv --noquotes; }

ensure_group() { # org name
  [ -n "$(group "$1" "$2")" ] || "$KC" create "organizations/$1/groups" -r $R -s "name=$2" >/dev/null
  group "$1" "$2"
}
ensure_child() { # org parent name
  [ -n "$(child "$1" "$2" "$3")" ] || "$KC" create "organizations/$1/groups/$2/children" -r $R -s "name=$3" >/dev/null
  child "$1" "$2" "$3"
}
ensure_user() { # username first last [org group]
  local id
  id=$(user "$1")
  if [ -z "$id" ]; then
    "$KC" create users -r $R -s "username=$1" -s enabled=true -s "firstName=$2" -s "lastName=$3" \
      -s "email=$1@brightwater.test" -s emailVerified=true >/dev/null
    id=$(user "$1")
  fi
  "$KC" set-password -r $R --userid "$id" --new-password "$UPW"
  if [ -n "${4:-}" ]; then
    "$KC" create "organizations/$4/members" -r $R -b "\"$id\"" >/dev/null 2>&1 || true
    # Fails when they already are; that is fine.
    "$KC" update "organizations/$4/groups/$5/members/$id" -r $R -b '{}' >/dev/null 2>&1 || true
  fi
  echo "$1"
}

ORG=$(org brightwater)
if [ -z "$ORG" ]; then
  "$KC" create organizations -r $R -s "name=Brightwater Logistics" -s alias=brightwater \
    -s enabled=true -s 'domains=[{"name":"brightwater.test"}]' >/dev/null
  ORG=$(org brightwater)
fi
ADMINS=$(ensure_group "$ORG" admins)
FINANCE=$(ensure_group "$ORG" finance)
LEGAL=$(ensure_group "$ORG" legal)
ensure_group "$ORG" security >/dev/null
ensure_group "$ORG" contractors >/dev/null
PAYABLES=$(ensure_child "$ORG" "$FINANCE" accounts-payable)
MANAGERS=$(ensure_child "$ORG" "$FINANCE" workspace-managers)

ensure_user rduarte Ravi Duarte "$ORG" "$ADMINS"
"$KC" add-roles -r $R --uusername rduarte --rolename classifyre-operator
ensure_user mlindqvist Mara Lindqvist "$ORG" "$MANAGERS"
ensure_user tbrenner Tomasz Brenner "$ORG" "$PAYABLES"
ensure_user iokafor Ines Okafor "$ORG" "$LEGAL"
ensure_user kstrand Kai Strand

PUBLIC=$(org public)
if [ -n "$PUBLIC" ]; then
  ensure_user npark Noa Park "$PUBLIC" "$(ensure_group "$PUBLIC" admins)"
fi
echo "Brightwater Logistics is ready"
EOF
