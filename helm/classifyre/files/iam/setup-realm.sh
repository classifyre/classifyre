#!/usr/bin/env bash
# Sets up the identity server's `classifyre` realm (docs/prd/IAM-access-management.md §9.2).
#
# Runs on every install and upgrade, with kcadm.sh from the same image as the
# server, so the setup always matches the server version. Every step is
# "ensure": it creates what is missing and updates what it owns. It never
# deletes anything, and it never touches group membership or users other than
# the first tenant admin: people are managed by tenant admins and identity
# providers, not by the chart.
set -euo pipefail

KC=/opt/keycloak/bin/kcadm.sh
R="$IAM_REALM"

until "$KC" config credentials --server "$IAM_INTERNAL_URL" --realm master \
  --user admin --password "$IAM_ADMIN_PASSWORD" >/dev/null 2>&1; do
  echo "waiting for the identity server at $IAM_INTERNAL_URL"
  sleep 5
done

# id of the first object at `path` whose `field` equals `value`, or empty.
# Extra arguments narrow the listing (`-q username=x`); without them it asks
# for one large page, since some listings default to 10 or 100 entries.
# Plain bash: the server image is minimal and has no awk.
find_id() {
  local path=$1 field=$2 value=$3 id val
  shift 3
  [ $# -eq 0 ] && set -- -q first=0 -q max=10000
  while IFS=, read -r id val; do
    if [ "$val" = "$value" ]; then
      echo "$id"
      return
    fi
  done < <("$KC" get "$path" -r "$R" "$@" --fields "id,$field" --format csv --noquotes 2>/dev/null)
}

echo "realm $R"
if ! "$KC" get "realms/$R" >/dev/null 2>&1; then
  "$KC" create realms -s "realm=$R" -s enabled=true
fi
"$KC" update "realms/$R" \
  -s displayName=Classifyre \
  -s organizationsEnabled=true \
  -s registrationAllowed=false \
  -s loginWithEmailAllowed=true \
  -s duplicateEmailsAllowed=false \
  -s "accessTokenLifespan=$IAM_ACCESS_TOKEN_LIFESPAN" \
  -s bruteForceProtected=true \
  -s eventsEnabled=true \
  -s adminEventsEnabled=true \
  -s adminEventsDetailsEnabled=true

echo "role classifyre-operator"
if ! "$KC" get roles/classifyre-operator -r "$R" >/dev/null 2>&1; then
  "$KC" create roles -r "$R" -s name=classifyre-operator \
    -s 'description=Creates and changes tenants. Sees no workspace content unless also granted.'
fi

echo "client scope classifyre"
SCOPE_ID=$(find_id client-scopes name classifyre)
if [ -z "$SCOPE_ID" ]; then
  "$KC" create client-scopes -r "$R" -s name=classifyre -s protocol=openid-connect \
    -s 'attributes."include.in.token.scope"=true'
  SCOPE_ID=$(find_id client-scopes name classifyre)
fi
# Tokens for the web are meant for the API: the API refuses any other audience.
if [ -z "$(find_id "client-scopes/$SCOPE_ID/protocol-mappers/models" name classifyre-api-audience)" ]; then
  "$KC" create "client-scopes/$SCOPE_ID/protocol-mappers/models" -r "$R" \
    -s name=classifyre-api-audience -s protocol=openid-connect \
    -s protocolMapper=oidc-audience-mapper \
    -s 'config."included.client.audience"=classifyre-api' \
    -s 'config."access.token.claim"=true' \
    -s 'config."id.token.claim"=false'
fi
ORG_SCOPE_ID=$(find_id client-scopes name organization)

echo "client classifyre-api"
API_ID=$(find_id clients clientId classifyre-api)
if [ -z "$API_ID" ]; then
  "$KC" create clients -r "$R" -s clientId=classifyre-api
  API_ID=$(find_id clients clientId classifyre-api)
fi
"$KC" update "clients/$API_ID" -r "$R" \
  -s publicClient=false \
  -s "secret=$IAM_API_CLIENT_SECRET" \
  -s serviceAccountsEnabled=true \
  -s standardFlowEnabled=false \
  -s implicitFlowEnabled=false \
  -s directAccessGrantsEnabled=false \
  -s fullScopeAllowed=false
# Read users, organizations and their groups; never change them.
"$KC" add-roles -r "$R" --uusername service-account-classifyre-api \
  --cclientid realm-management --rolename view-users --rolename view-organizations
# With full scope off, a role the account holds only reaches its token when
# the client's scope maps it too.
RM_ID=$(find_id clients clientId realm-management)
{
  echo "["
  "$KC" get "clients/$RM_ID/roles/view-users" -r "$R"
  echo ","
  "$KC" get "clients/$RM_ID/roles/view-organizations" -r "$R"
  echo "]"
} | "$KC" create "clients/$API_ID/scope-mappings/clients/$RM_ID" -r "$R" -f - >/dev/null

echo "client classifyre-web"
WEB_ID=$(find_id clients clientId classifyre-web)
if [ -z "$WEB_ID" ]; then
  "$KC" create clients -r "$R" -s clientId=classifyre-web
  WEB_ID=$(find_id clients clientId classifyre-web)
fi
"$KC" update "clients/$WEB_ID" -r "$R" \
  -s name=Classifyre \
  -s publicClient=false \
  -s "secret=$IAM_WEB_CLIENT_SECRET" \
  -s standardFlowEnabled=true \
  -s implicitFlowEnabled=false \
  -s directAccessGrantsEnabled=false \
  -s serviceAccountsEnabled=false \
  -s fullScopeAllowed=false \
  -s "rootUrl=$IAM_APP_URL" \
  -s "redirectUris=[\"$IAM_APP_URL/auth/callback\"]" \
  -s "webOrigins=[\"$IAM_APP_URL\"]" \
  -s 'attributes."pkce.code.challenge.method"=S256' \
  -s "attributes.\"post.logout.redirect.uris\"=$IAM_APP_URL/*"
"$KC" update "clients/$WEB_ID/default-client-scopes/$SCOPE_ID" -r "$R" >/dev/null
if [ -n "$ORG_SCOPE_ID" ]; then
  "$KC" update "clients/$WEB_ID/optional-client-scopes/$ORG_SCOPE_ID" -r "$R" >/dev/null 2>&1 || true
fi

echo "tenant $IAM_TENANT_ALIAS"
ORG_ID=$(find_id organizations alias "$IAM_TENANT_ALIAS")
if [ -z "$ORG_ID" ]; then
  "$KC" create organizations -r "$R" -s "name=$IAM_TENANT_NAME" -s "alias=$IAM_TENANT_ALIAS" \
    -s enabled=true
  ORG_ID=$(find_id organizations alias "$IAM_TENANT_ALIAS")
fi
ADMINS_ID=$(find_id "organizations/$ORG_ID/groups" name admins)
if [ -z "$ADMINS_ID" ]; then
  "$KC" create "organizations/$ORG_ID/groups" -r "$R" -s name=admins
  ADMINS_ID=$(find_id "organizations/$ORG_ID/groups" name admins)
fi

echo "first tenant admin $IAM_BOOTSTRAP_ADMIN"
# Created once. Afterwards the person owns their account: the job never
# resets the password or re-adds them to a group they were taken out of.
if [ -z "$(find_id users username "$IAM_BOOTSTRAP_ADMIN" -q "username=$IAM_BOOTSTRAP_ADMIN" -q exact=true)" ]; then
  "$KC" create users -r "$R" -s "username=$IAM_BOOTSTRAP_ADMIN" -s enabled=true \
    ${IAM_BOOTSTRAP_ADMIN_EMAIL:+-s "email=$IAM_BOOTSTRAP_ADMIN_EMAIL"} \
    -s 'requiredActions=["UPDATE_PASSWORD"]'
  USER_ID=$(find_id users username "$IAM_BOOTSTRAP_ADMIN" -q "username=$IAM_BOOTSTRAP_ADMIN" -q exact=true)
  "$KC" set-password -r "$R" --userid "$USER_ID" \
    --new-password "$IAM_BOOTSTRAP_ADMIN_PASSWORD" --temporary
  "$KC" create "organizations/$ORG_ID/members" -r "$R" -b "\"$USER_ID\""
  "$KC" update "organizations/$ORG_ID/groups/$ADMINS_ID/members/$USER_ID" -r "$R" -b '{}'
fi

echo "done"
