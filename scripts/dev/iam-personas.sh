#!/usr/bin/env bash
# Persona checks for sign-in and access (docs/prd/IAM-access-management.md §7,
# step 8, people and groups of step 8c). Installs a throwaway release with sign-in on next to the dev stack,
# seeds groups and invented users, gives the grants of §7 through the API,
# then checks what each persona can and cannot do. Exits non-zero on any
# mismatch and removes everything afterwards (KEEP=1 keeps it for poking).
#
#   ./scripts/dev/iam-personas.sh
#
# Needs the k3d dev cluster (./scripts/dev/create-cluster.sh); the API runs
# from your working copy like the dev stack does. Takes about 10 minutes, most
# of it creating three workspaces and waiting out the one-minute membership
# cache for the mover, leaver and contractor cases.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NS=${IAM_PERSONAS_NAMESPACE:-iam-personas}
REL=personas
API_PORT=${IAM_PERSONAS_API_PORT:-8814}
# Not 8280: the dev stack (`skaffold dev` with the `iam` profile) forwards
# its identity server there for the local web app. Two forwards on one port
# race and the token calls land on the dev realm instead of the suite's.
IAM_PORT=${IAM_PERSONAS_IAM_PORT:-8182}
B="http://127.0.0.1:${API_PORT}"
KCURL="http://localhost:${IAM_PORT}/iam/realms/classifyre"
PF_PIDS=()
FAILED=0
RESULTS=()

cleanup() {
  for pid in "${PF_PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  if [ "${KEEP:-0}" != "1" ]; then
    helm uninstall "$REL" -n "$NS" >/dev/null 2>&1 || true
    kubectl delete namespace "$NS" --wait=false >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

say() { printf '\n== %s\n' "$*"; }
# Every check pipes an HTTP body through here. When the API is unreachable the
# body is empty (or an error page), so a bare `d['…']` would raise: stderr
# noise, an empty result, a confusing FAIL. Fail closed instead — print a
# marker that never equals the expected value, so the check still fails but
# the log says why.
json() { python3 -c "
import sys,json
try:
    d=json.loads(sys.stdin.read() or 'null', strict=False)
    $1
except Exception as e:
    print('FAIL-CLOSED: ' + type(e).__name__)
"; }

check() { # check <case> <description> <expected> <actual>
  if [ "$3" = "$4" ]; then
    RESULTS+=("PASS  $1  $2")
  else
    RESULTS+=("FAIL  $1  $2 (expected $3, got $4)")
    FAILED=1
  fi
}

# The suite only checks what the API does, so keep every call bare: a NestJS
# JSON body parser refuses an empty body that carries a content type, and the
# generated TypeScript client never sends one bodyless either. The one POST
# still carries its JSON body.
token() { # token <username> [tenant]
  curl -s -d client_id=persona-test -d "username=$1" -d password=persona-pass-1 \
    -d grant_type=password -d "scope=openid organization:${2:-default}" \
    "$KCURL/protocol/openid-connect/token" | json "print((d or {}).get('access_token',''))"
}
status() { # status <user[@tenant]|-> <method> <path> [body]
  # The content type only rides along with a body: the JSON body parser
  # refuses an empty body that carries one, so a bodyless PUT/DELETE with the
  # header answers 400 before authentication runs (see above token()).
  local args=(-s -o /dev/null -w '%{http_code}' -X "$2") auth
  if [ $# -ge 4 ]; then
    args+=(-H 'Content-Type: application/json' -d "$4")
  fi
  if auth=$(authed "$1"); then
    args+=(-H "$auth")
  fi
  curl "${args[@]}" "$B$3"
}
# "user@tenant" -> tenant; plain "user" -> default.
tenant_of() { case "$1" in *@*) echo "${1#*@}" ;; *) echo default ;; esac; }
# One place builds the Authorization header. The command substitution runs
# before curl starts, so a token fetch can never steal curl's stdin or drain
# the response pipe into the next stage (a bodyless pipe the reader parses as
# the response body).
authed() { # authed <user[@tenant]> [tenant]: prints "Authorization: Bearer <token>"
  if [ "$1" = "-" ]; then return 1; fi
  local tenant=${2:-$(tenant_of "$1")}
  printf 'Authorization: Bearer %s' "$(token "${1%@*}" "$tenant")"
}
get() { curl -s -H "$(authed "$1" "${3:-$(tenant_of "$1")}")" "$B$2"; }
post() { curl -s -X POST -H "$(authed "$1")" -H 'Content-Type: application/json' -d "$3" "$B$2"; }
slugs() { get "$1" /namespaces "${2:-default}" | json "print(','.join(sorted(n['slug'] for n in d)))"; }
has_cap() { get "$1" "/$2/me" | json "print('yes' if '$3' in d['capabilities'] else 'no')"; }
grant() { # grant <subjectType> <subjectId> <role> <scopeType> <scopeId> [expiresAt]
  post admin /tenant/grants "{\"subjectType\":\"$1\",\"subjectId\":\"$2\",\"roleKey\":\"$3\",\"scopeType\":\"$4\",\"scopeId\":\"$5\"${6:+,\"expiresAt\":\"$6\"}}" \
    | json "print(d.get('id') or d)"
}

say "install throwaway release $REL in $NS"
kubectl get namespace "$NS" >/dev/null 2>&1 && { echo "namespace $NS exists; remove it first"; exit 1; }
kubectl create namespace "$NS" >/dev/null
helm install "$REL" "$ROOT/helm/classifyre" -n "$NS" \
  -f "$ROOT/helm/develop/values-dev.yaml" -f "$ROOT/helm/develop/values-dev-iam.yaml" \
  --set worker.replicaCount=0 --set ingress.enabled=false --set priorityClasses.create=false \
  --set postgres.embedded.persistence.enabled=false --set api.cliCache.enabled=false \
  --set api.embedding.enabled=false >/dev/null

say "wait for the API, the identity server and the realm setup"
# Give up after ten minutes and say why, instead of waiting forever on pods
# the cluster cannot place (a full node is the usual cause).
waited=0
until kubectl -n "$NS" get pods --no-headers 2>/dev/null | grep -q "api.*1/1" &&
  kubectl -n "$NS" get jobs --no-headers 2>/dev/null | grep -q Complete; do
  if [ "$waited" -ge 600 ]; then
    kubectl -n "$NS" get pods --no-headers 2>/dev/null
    kubectl -n "$NS" get events --field-selector type=Warning --no-headers 2>/dev/null |
      awk '{$1=$2=$3=""; print}' | sort -u | tail -5
    echo "FAIL: the release did not come up within ten minutes"; exit 1
  fi
  sleep 10; waited=$((waited + 10))
done
# The API retries its tenant setup for about ten minutes, then gives up.
for _ in $(seq 1 72); do
  LOGS=$(kubectl -n "$NS" logs "deploy/$REL-classifyre-api" --tail=500 2>/dev/null || true)
  echo "$LOGS" | grep -q "Sign-in tenants are set up" && break
  if echo "$LOGS" | grep -q "Sign-in tenant setup gave up"; then
    echo "$LOGS" | grep "IamBootstrapService" | tail -3
    echo "FAIL: the API could not set up the sign-in tenant"; exit 1
  fi
  sleep 10
done
echo "$LOGS" | grep -q "Sign-in tenants are set up" || { echo "FAIL: tenant setup timed out"; exit 1; }
kubectl -n "$NS" port-forward "svc/$REL-classifyre-api" "$API_PORT:8000" >/dev/null 2>&1 & PF_PIDS+=($!)
kubectl -n "$NS" port-forward "svc/$REL-classifyre-iam" "$IAM_PORT:8080" >/dev/null 2>&1 & PF_PIDS+=($!)
until curl -s -m 3 "$B/ping" | grep -q pong; do sleep 2; done
until curl -s -m 3 "$KCURL/.well-known/openid-configuration" | grep -q issuer; do sleep 2; done

say "seed groups and personas"
ADMIN_PW=$(kubectl -n "$NS" get secret "$REL-classifyre-iam" -o jsonpath='{.data.admin-password}' | base64 -d)
SEED=$(kubectl -n "$NS" exec -i "deploy/$REL-classifyre-iam" -c iam -- env ADMIN_PW="$ADMIN_PW" bash -s \
  < "$ROOT/scripts/dev/iam-personas-seed.sh" 2>/dev/null)
eval "$(echo "$SEED" | tr ' ' '\n' | grep '=' | sed 's/^/export /')"
TENANT=$(get admin /tenant | json "print(d['id'])")

say "workspaces (each provisions its schema, about a minute)"
create() { post admin /namespaces "{\"name\":\"$1\",\"slug\":\"$1\",\"ownerGroupId\":\"$2\"}" | json "print(d['id'])"; }
WS_LEDGER=$(create fin-ledger "$FIN")
WS_Q3=$(create fin-q3 "$AP")
WS_SALES=$(create sales-pipeline "$SALES")

say "grants (§7)"
grant group "$FIN" viewer group "$FIN" >/dev/null                     # U1, mover, leaver
grant group "$WM" workspace-manager group "$FIN" >/dev/null           # U5
grant group "$AP" investigator workspace "$WS_LEDGER" >/dev/null      # U2
grant group "$DATA" source-manager group "$FIN" >/dev/null            # U3
grant group "$SALES" investigator group "$SALES" >/dev/null           # U4
grant group "$LEGAL" viewer workspace "$WS_Q3" >/dev/null             # U6
grant group "$AUDIT" auditor tenant "$TENANT" >/dev/null              # U9
SOON=$(python3 -c "import datetime; print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=75)).isoformat())")
grant user "$U_CONTRACTOR" investigator workspace "$WS_LEDGER" "$SOON" >/dev/null   # U10

say "checks"
check U1 "finance viewer sees finance workspaces" "fin-ledger,fin-q3" "$(slugs controller)"
check U1 "finance viewer reads sources" 200 "$(status controller GET /fin-ledger/sources)"
check U1 "finance viewer cannot add a source" 403 "$(status controller POST /fin-ledger/sources '{"name":"x","type":"LOCAL_FOLDER","config":{}}')"
MCP=$(post controller /fin-ledger/instance-settings/mcp/tokens '{"name":"controller-agent"}' | json "print(d['plainTextToken'])")
WRITES=$(curl -s -X POST -H "Authorization: Bearer $MCP" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  "$B/fin-ledger/mcp" | json "print(sum(1 for t in d['result']['tools'] if not t.get('annotations',{}).get('readOnlyHint')))")
check U1 "the viewer's MCP agent only gets read-only tools" 0 "$WRITES"
check U16 "a viewer cannot export data" 403 "$(status controller GET /fin-ledger/search/findings/export)"
check U2 "investigator can work cases" yes "$(has_cap investigator fin-ledger case.edit)"
check U2 "investigator cannot change sources" no "$(has_cap investigator fin-ledger source.manage)"
check U2 "investigator creates an inquiry" 201 "$(status investigator POST /fin-ledger/inquiries '{"title":"persona check"}')"
check U3 "source manager manages sources" yes "$(has_cap engineer fin-ledger source.manage)"
check U3 "source manager does not see cases" 403 "$(status engineer GET /fin-ledger/cases)"
check U4 "sales sees only sales" "sales-pipeline" "$(slugs seller)"
check U4 "sales gets 404 for a finance workspace" 404 "$(status seller GET /fin-ledger/sources)"
check U5 "workspace manager may create for /finance" yes "$(get manager /namespaces/owning-groups | json "print('yes' if any(g['path']=='/finance' for g in d) else 'no')")"
# Built outside "$( … )": bash 3.2 (macOS) keeps the backslashes of \" there.
FOR_SALES="{\"name\":\"nope\",\"ownerGroupId\":\"$SALES\"}"
check U5 "workspace manager may not create for /sales" 403 "$(status manager POST /namespaces "$FOR_SALES")"
check U6 "legal sees the one shared workspace" "fin-q3" "$(slugs counsel)"
check U6 "legal cannot change it" 403 "$(status counsel POST /fin-q3/inquiries '{"title":"x"}')"
check U9 "auditor reads the tenant audit trail" 200 "$(status auditor GET /tenant/audit-events)"
check U9 "auditor does not read findings" 403 "$(status auditor GET /fin-ledger/findings/stats)"
check U14 "tenant admin manages tenant grants" 200 "$(status admin GET /tenant/grants)"
check U14 "a viewer does not" 403 "$(status controller GET /tenant/grants)"
check H7 "another tenant sees nothing" "" "$(slugs outsider globex)"
check H7 "another tenant gets 404" 404 "$(status outsider@globex GET /fin-ledger/sources)"
check H7 "no sign-in is 401" 401 "$(status - GET /namespaces)"
check U10 "contractor works until the end date" 200 "$(status contractor GET /fin-ledger/sources)"

say "people and groups, managed in Classifyre (step 8c)"
req() { # req <method> <path> [body]: as the tenant admin, prints the body
  # Like status(): no content type without a body (the JSON body parser 400s
  # an empty body that carries one), so bodyless DELETEs and GETs are sent bare.
  local method=$1 path=$2
  if [ $# -ge 3 ]; then
    curl -s -X "$method" -H "$(authed admin)" -H 'Content-Type: application/json' -d "$3" "$B$path"
  else
    curl -s -X "$method" -H "$(authed admin)" "$B$path"
  fi
}
EAST=$(req POST /tenant/groups "{\"name\":\"east\",\"parentId\":\"$SALES\"}" | json "print(d.get('path','') + '|' + d.get('id',''))")
check U17 "tenant admin creates a group inside /sales" "/sales/east" "${EAST%%|*}"
EAST=${EAST#*|}
NEWBIE=$(req POST /tenant/people '{"email":"newbie@example.test","firstName":"New","lastName":"Persona"}' \
  | json "print(d['person']['id'] + '|' + ('yes' if d.get('temporaryPassword') else 'no'))")
check U17 "adding a new person gives a temporary password" yes "${NEWBIE#*|}"
NEWBIE=${NEWBIE%%|*}
check U17 "tenant admin puts them in the group" 204 "$(status admin PUT "/tenant/groups/$EAST/members/$NEWBIE")"
check U17 "the people list shows the group" yes "$(req GET /tenant/people | json "print('yes' if any(p['id']=='$NEWBIE' and '$EAST' in p['groupIds'] for p in d) else 'no')")"
check U17 "a viewer cannot list or change people" 403 "$(status controller GET /tenant/people)"
check U17 "a workspace manager cannot create groups" 403 "$(status manager POST /tenant/groups '{"name":"x"}')"
check U17 "another tenant's person is refused like an unusable address" PERSON_UNAVAILABLE \
  "$(req POST /tenant/people '{"email":"outsider@example.test","firstName":"O","lastName":"P"}' | json "print(d.get('code'))")"
GLOBEX_ADMINS=$(kubectl -n "$NS" exec -i "deploy/$REL-classifyre-iam" -c iam -- env ADMIN_PW="$ADMIN_PW" GLOBEX="$GLOBEX" bash -c \
  'K=/opt/keycloak/bin/kcadm.sh; $K config credentials --server http://localhost:8080/iam --realm master --user admin --password "$ADMIN_PW" >/dev/null 2>&1; $K create organizations/$GLOBEX/groups -r classifyre -s name=globex-team -i 2>/dev/null || $K get organizations/$GLOBEX/groups -r classifyre --fields id --format csv --noquotes | head -1' | tr -d '\r')
check U17 "another tenant's group is not found" 404 "$(status admin PUT "/tenant/groups/$GLOBEX_ADMINS/members/$NEWBIE")"
ME=$(req GET /tenant/people | json "print(next(p['id'] for p in d if p['isYou']))")
check U17 "nobody removes themselves" 403 "$(status admin DELETE "/tenant/people/$ME")"
check U17 "a group that owns workspaces cannot be deleted" GROUP_OWNS_WORKSPACES "$(req DELETE "/tenant/groups/$FIN" | json "print(d.get('code'))")"
check U17 "removing a person made here deletes their account" True "$(req DELETE "/tenant/people/$NEWBIE" | json "print(d.get('accountDeleted'))")"
check U17 "an empty group is deleted" 204 "$(status admin DELETE "/tenant/groups/$EAST")"
check U17 "every change is in the tenant's activity" yes "$(req GET /tenant/audit-events | json "a=set(e['action'] for e in d); need=set(['group.created','person.added','group.member_added','person.removed','group.deleted']); print('yes' if need <= a else sorted(a))")"

say "mover, leaver and the contractor's end date (one-minute cache)"
kubectl -n "$NS" exec -i "deploy/$REL-classifyre-iam" -c iam -- env ADMIN_PW="$ADMIN_PW" \
  ACME="$ACME" FIN="$FIN" SALES="$SALES" MOVER="$U_MOVER" LEAVER="$U_LEAVER" bash -s >/dev/null 2>&1 <<'EOF'
KC=/opt/keycloak/bin/kcadm.sh
$KC config credentials --server http://localhost:8080/iam --realm master --user admin --password "$ADMIN_PW"
$KC delete organizations/$ACME/groups/$FIN/members/$MOVER -r classifyre
$KC update organizations/$ACME/groups/$SALES/members/$MOVER -r classifyre -b '{}'
$KC update users/$LEAVER -r classifyre -s enabled=false
EOF
LEAVER_TOKEN=$(token leaver 2>/dev/null || true)
sleep 80
check U11 "mover lost finance" 404 "$(status mover GET /fin-ledger/sources)"
check U11 "mover gained sales" 200 "$(status mover GET /sales-pipeline/sources)"
check U12 "leaver can no longer sign in" "" "$(token leaver)"
check U12 "leaver's token stopped working" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $LEAVER_TOKEN" "$B/namespaces")"
check U10 "contractor lost access after the end date" 404 "$(status contractor GET /fin-ledger/sources)"

say "each tenant in its own database (docs/prd/TEN §4.1)"
operator() { kubectl -n "$NS" exec "deploy/$REL-classifyre-api" -- sh -c "cd /workspace/apps/api && bun src/admin.ts $*"; }
pg() { # pg <database> <sql>: one value, as the chart's superuser
  kubectl -n "$NS" exec "deploy/$REL-classifyre-postgres" -- psql -U postgres -d "$1" -tAc "$2" | tr -d '[:space:]'
}
DEFAULT_ID=$(pg classifyre_control "SELECT id FROM iam_tenants WHERE alias = 'default'")
DEFAULT_DB="classifyre_t_${DEFAULT_ID//-/}"
check T1 "the control database holds no workspace data" 0 "$(pg classifyre_control "SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'ns\_%'")"
check T1 "the tenant's database holds its three workspaces" 3 "$(pg "$DEFAULT_DB" "SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'ns\_%'")"
check T1 "it is marked as that tenant's" "tenant|$DEFAULT_ID" "$(pg "$DEFAULT_DB" "SELECT kind || '|' || tenant_id FROM classifyre_database")"
check T1 "its role opens no other database" "false,false" "$(pg postgres "SELECT string_agg(has_database_privilege('$DEFAULT_DB', d, 'CONNECT')::text, ',' ORDER BY d) FROM unnest(ARRAY['classifyre', 'classifyre_control']) AS d")"

say "operator copies workspaces between a tenant and the open database (docs/prd/TEN §4.9)"
operator workspaces copy --to-local fin-q3 >/dev/null
check T0 "a copy to the open database leaves the tenant's in place" "fin-ledger,fin-q3,sales-pipeline" "$(slugs admin)"
check T0 "and is in the open database" fin-q3 "$(pg classifyre "SELECT string_agg(slug, ',') FROM namespaces WHERE status = 'active'")"
check T0 "the open database holds no tenant's workspace or access" "0|0" "$(pg classifyre "SELECT (SELECT count(*) FROM namespaces WHERE tenant_id <> '00000000-0000-4000-8000-0000000000aa') || '|' || (SELECT count(*) FROM iam_grants)")"
Q3_SCHEMA=$(pg classifyre_control "SELECT schema_name FROM namespaces WHERE slug = 'fin-q3'")
Q3_COPY=$(pg classifyre "SELECT schema_name FROM namespaces WHERE slug = 'fin-q3'")
check T0 "with its data, as a new workspace" "$(pg "$DEFAULT_DB" "SELECT count(*) FROM $Q3_SCHEMA.audit_events"),new" "$(pg classifyre "SELECT count(*) FROM $Q3_COPY.audit_events"),$([ "$Q3_COPY" != "$Q3_SCHEMA" ] && echo new || echo same)"
check T0 "a copy to a taken address is refused" 2 "$(operator workspaces copy --to-tenant globex fin-q3 >/dev/null 2>&1; echo $?)"
EVENTS=$(get admin /tenant/audit-events)
COPIES=$(echo "$EVENTS" | json "a=[e['action'] for e in d if (e.get('detail') or {}).get('slug')=='fin-q3']; print('yes' if 'workspace.copied_out' in a else a)")
[ "$COPIES" = yes ] || COPIES="$COPIES; body: ${EVENTS:0:300}"
check T0 "the copy is in the tenant's activity" yes "$COPIES"
# A second workspace made without sign-in, under an address no tenant uses,
# for the Platform page to bring in.
pg classifyre "UPDATE namespaces SET slug = 'fin-q3-local' WHERE slug = 'fin-q3'" >/dev/null

say "operators manage tenants on the Platform page (docs/prd/TEN §4.7)"
optoken() { # an operator's token names no tenant
  curl -s -d client_id=persona-test -d username=operator -d password=persona-pass-1 \
    -d grant_type=password -d scope=openid "$KCURL/protocol/openid-connect/token" \
    | json "print((d or {}).get('access_token',''))"
}
op() { # op <method> <path> [body]: as the operator, prints the body
  local args=(-s -X "$1" -H "Authorization: Bearer $(optoken)")
  if [ $# -ge 3 ]; then args+=(-H 'Content-Type: application/json' -d "$3"); fi
  curl "${args[@]}" "$B$2"
}
opstatus() { # opstatus <method> <path> [body]: as the operator, prints the status
  local args=(-s -o /dev/null -w '%{http_code}' -X "$1" -H "Authorization: Bearer $(optoken)")
  if [ $# -ge 3 ]; then args+=(-H 'Content-Type: application/json' -d "$3"); fi
  curl "${args[@]}" "$B$2"
}
tenant_id() { op GET /platform/tenants | json "print(next((t['id'] for t in d if t['alias']=='$1'), ''))"; }
check P "an operator in no tenant lists every tenant" "default,globex" "$(op GET /platform/tenants | json "print(','.join(sorted(t['alias'] for t in d)))")"
check P "and sees no workspace" NO_TENANT "$(op GET /namespaces | json "print(d.get('code'))")"
check P "a tenant member who is not an operator is refused" 403 "$(status controller GET /platform/tenants)"
INITECH='{"name":"Initech","alias":"initech","adminEmail":"bill@example.test","adminFirstName":"Bill","adminLastName":"Persona"}'
check P "creating a tenant gives its first admin a temporary password" yes "$(op POST /platform/tenants "$INITECH" | json "print('yes' if d.get('temporaryPassword') and d['tenant']['admins'][0]['email']=='bill@example.test' else d)")"
check P "an alias is never used twice" ALIAS_TAKEN "$(op POST /platform/tenants "$INITECH" | json "print(d.get('code'))")"
INITECH_ID=$(tenant_id initech)
BILL=$(op GET /platform/tenants | json "print(next(t['admins'][0]['id'] for t in d if t['alias']=='initech'))")
check P "the last admin cannot be removed" 403 "$(opstatus DELETE "/platform/tenants/$INITECH_ID/admins/$BILL")"
check P "a second admin is added by email" yes "$(op POST "/platform/tenants/$INITECH_ID/admins" '{"email":"milton@example.test","firstName":"Milton","lastName":"Persona"}' | json "print('yes' if d.get('temporaryPassword') else d)")"
check P "then the first can go" 204 "$(opstatus DELETE "/platform/tenants/$INITECH_ID/admins/$BILL")"
GLOBEX_ID=$(tenant_id globex)
check P "suspending a tenant" suspended "$(op POST "/platform/tenants/$GLOBEX_ID/suspend" | json "print(d['status'])")"
check P "refuses its people" TENANT_SUSPENDED "$(get outsider /namespaces globex | json "print(d.get('code'))")"
op POST "/platform/tenants/$GLOBEX_ID/resume" >/dev/null
check P "and resuming lets them back in" 200 "$(status outsider@globex GET /namespaces)"
check P "workspaces made without sign-in are offered for import" fin-q3-local "$(op GET /platform/workspaces/local | json "print(','.join(w['slug'] for w in d))")"
check P "and copied into a tenant" fin-q3-local "$(op POST "/platform/tenants/$INITECH_ID/workspaces" '{"slugs":["fin-q3-local"]}' | json "print(','.join(d['copied']))")"
INITECH_DB="classifyre_t_${INITECH_ID//-/}"
check P "which gets the tenant its own database" "$INITECH_DB" "$(op GET /platform/tenants | json "print(next(t['database'] for t in d if t['alias']=='initech'))")"
check P "a tenant with workspaces is not deleted" TENANT_HAS_WORKSPACES "$(op DELETE "/platform/tenants/$INITECH_ID?confirm=initech" | json "print(d.get('code'))")"
pg classifyre_control "UPDATE namespaces SET status = 'deleted', deleted_at = now() WHERE slug = 'fin-q3-local'" >/dev/null
check P "nor without its alias typed" 400 "$(opstatus DELETE "/platform/tenants/$INITECH_ID?confirm=initec")"
check P "an empty tenant is deleted" 204 "$(opstatus DELETE "/platform/tenants/$INITECH_ID?confirm=initech")"
check P "and stays listed as deleted, alias reserved" deleted "$(op GET /platform/tenants | json "print(next(t['status'] for t in d if t['alias']=='initech'))")"
check P "its database stays while a deleted workspace is kept" 1 "$(pg postgres "SELECT count(*) FROM pg_database WHERE datname = '$INITECH_DB'")"
check P "the copy is in that tenant's activity" workspace.copied_in "$(pg classifyre_control "SELECT action FROM iam_audit_events WHERE tenant_id = '$INITECH_ID' AND action LIKE 'workspace.%'")"
check P "globex's activity has the suspension and the resume" "tenant.resumed,tenant.suspended" "$(pg classifyre_control "SELECT string_agg(action, ',' ORDER BY action) FROM iam_audit_events WHERE tenant_id = '$GLOBEX_ID' AND action LIKE 'tenant.%'")"

say "sign-in turned off by mistake (docs/prd/TEN §4.2)"
helm upgrade "$REL" "$ROOT/helm/classifyre" -n "$NS" --reuse-values --set iam.enabled=false >/dev/null
kubectl -n "$NS" rollout status "deploy/$REL-classifyre-api" --timeout=600s >/dev/null
# The forward was bound to the replaced pod.
kill "${PF_PIDS[0]}" 2>/dev/null || true
kubectl -n "$NS" port-forward "svc/$REL-classifyre-api" "$API_PORT:8000" >/dev/null 2>&1 & PF_PIDS+=($!)
until curl -s -m 3 "$B/ping" | grep -q pong; do sleep 2; done
check T0 "without sign-in only the open database is listed" "fin-q3-local" "$(curl -s "$B/namespaces" | json "print(','.join(sorted(n['slug'] for n in d)))")"
check T0 "a tenant's workspace answers 404 by its address" 404 "$(status - GET /fin-ledger/sources)"
check T0 "the tenants are untouched in their databases" 3 "$(pg "$DEFAULT_DB" "SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'ns\_%'")"

say "results"
printf '%s\n' "${RESULTS[@]}"
if [ "$FAILED" = "1" ]; then echo "SOME CHECKS FAILED"; exit 1; fi
echo "all $(printf '%s\n' "${RESULTS[@]}" | grep -c PASS) checks passed"
