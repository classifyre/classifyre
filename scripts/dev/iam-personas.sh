#!/usr/bin/env bash
# Persona checks for sign-in and access (docs/prd/IAM-access-management.md §7,
# step 8; people and groups live in the identity server). Installs a throwaway release with sign-in on next to the dev stack,
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
  -f "$ROOT/helm/develop/values-dev.yaml" \
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
grant group "$CONTRACTORS" investigator workspace "$WS_LEDGER" "$SOON" >/dev/null  # U10
check G "a grant to one person is refused: access goes to groups" 400 \
  "$(status admin POST /tenant/grants "{\"subjectType\":\"user\",\"subjectId\":\"$U_CONTRACTOR\",\"roleKey\":\"viewer\",\"scopeType\":\"tenant\",\"scopeId\":\"$TENANT\"}")"

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
check H7 "no sign-in gets nothing private: 401" 401 "$(status - GET /fin-ledger/sources)"
check U10 "contractor works until the end date" 200 "$(status contractor GET /fin-ledger/sources)"

say "people and groups live in the identity server; Classifyre only reads them"
kc() { # kc <script>: kcadm as the identity server's admin, inside its pod
  kubectl -n "$NS" exec -i "deploy/$REL-classifyre-iam" -c iam -- env ADMIN_PW="$ADMIN_PW" bash -s <<KC 2>/dev/null | tr -d '\r'
K=/opt/keycloak/bin/kcadm.sh
\$K config credentials --server http://localhost:8080/iam --realm master --user admin --password "\$ADMIN_PW" >/dev/null 2>&1
$1
KC
}
check U17 "people are not changed through Classifyre" 404 "$(status admin POST /tenant/people '{"email":"x@example.test"}')"
check U17 "nor groups" 404 "$(status admin POST /tenant/groups '{"name":"x"}')"
check U17 "the API's account in the identity server only reads" "view-organizations,view-users" "$(kc '$K get-roles -r classifyre --uusername service-account-classifyre-api --cclientid realm-management --effective --fields name --format csv --noquotes' | grep -E '^(view|manage)-(users|organizations)$' | sort | paste -sd, -)"
# A group made and then removed in the identity server, with a grant on it.
EAST=$(kc "\$K create organizations/$ACME/groups/$SALES/children -r classifyre -s name=east -i")
grant group "$EAST" viewer tenant "$TENANT" >/dev/null
kc "\$K delete organizations/$ACME/groups/$EAST -r classifyre" >/dev/null

say "mover, leaver and the contractor's end date (one-minute cache)"
# Their token from before they leave: it must stop working within a minute.
LEAVER_TOKEN=$(token leaver)
[ -n "$LEAVER_TOKEN" ] || { echo "the leaver could not sign in before leaving" >&2; exit 1; }
kubectl -n "$NS" exec -i "deploy/$REL-classifyre-iam" -c iam -- env ADMIN_PW="$ADMIN_PW" \
  ACME="$ACME" FIN="$FIN" SALES="$SALES" MOVER="$U_MOVER" LEAVER="$U_LEAVER" bash -s >/dev/null 2>&1 <<'EOF'
KC=/opt/keycloak/bin/kcadm.sh
$KC config credentials --server http://localhost:8080/iam --realm master --user admin --password "$ADMIN_PW"
$KC delete organizations/$ACME/groups/$FIN/members/$MOVER -r classifyre
$KC update organizations/$ACME/groups/$SALES/members/$MOVER -r classifyre -b '{}'
$KC update users/$LEAVER -r classifyre -s enabled=false
EOF
sleep 80
check U11 "mover lost finance" 404 "$(status mover GET /fin-ledger/sources)"
check U11 "mover gained sales" 200 "$(status mover GET /sales-pipeline/sources)"
check U12 "leaver can no longer sign in" "" "$(token leaver)"
check U12 "leaver's token stopped working" 401 "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $LEAVER_TOKEN" "$B/namespaces")"
check U10 "contractor lost access after the end date" 404 "$(status contractor GET /fin-ledger/sources)"
check U17 "a group removed in the identity server keeps its grant, shown as removed" "Removed group" "$(get admin /tenant/grants | json "print(next((g['subjectLabel'] for g in d if g['subjectId']=='$EAST'), 'no grant'))")"

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

say "SQL over tables: who may query which table (docs/prd/DQ-data-query.md §4)"
LEDGER_SCHEMA=$(pg classifyre_control "SELECT schema_name FROM namespaces WHERE slug = 'fin-ledger'")
LAKE=00000000-0000-4000-8000-00000000d001
ORDERS=00000000-0000-4000-8000-00000000d002
PAYROLL=00000000-0000-4000-8000-00000000d003
# A bucket source with two Delta tables, as a scan would have left them.
pg "$DEFAULT_DB" "INSERT INTO $LEDGER_SCHEMA.sources (id, name, type, config, updated_at)
  VALUES ('$LAKE', 'Ledger lake', 'S3_COMPATIBLE_STORAGE',
  '{\"type\":\"S3_COMPATIBLE_STORAGE\",\"required\":{\"bucket\":\"ledger\"}}', now());
  INSERT INTO $LEDGER_SCHEMA.assets (id, hash, checksum, name, external_url, asset_type, source_type, source_id, metadata, updated_at)
  SELECT id, id, id, name, 's3://ledger/' || key, 'table', 'S3_COMPATIBLE_STORAGE', '$LAKE',
    jsonb_build_object('object_key', key, 'table_format', 'delta', 'columns', '[{\"name\":\"id\",\"type\":\"long\"}]'::jsonb), now()
  FROM (VALUES ('$ORDERS', 'orders', 'ap/orders'), ('$PAYROLL', 'payroll', 'hr/payroll')) AS t(id, name, key)" >/dev/null
data_grant() { # data_grant <group> <role> <asset|source> <id>: a grant body on one resource
  printf '{"subjectType":"group","subjectId":"%s","roleKey":"%s","scopeType":"%s","resourceId":"%s"}' "$1" "$2" "$3" "$4"
}
can_query() { # can_query <user> <sql name>: yes / no / absent
  get "$1" /fin-ledger/data-query/catalog | json "t=[t for s in d.get('sources',[]) for t in s['tables'] if t['sqlName']=='$2']; print(('yes' if t[0]['canQuery'] else 'no') if t else 'absent')"
}
run_code() { # run_code <user> <sql> [format]: the run's status and error code, or the refusal's code
  post "$1" /fin-ledger/query-runs "{\"sql\":\"$2\"${3:+,\"format\":\"$3\"}}" \
    | json "e=d.get('error'); print((d.get('status') or '') + ':' + ((e.get('code') if isinstance(e, dict) else None) or d.get('code') or ''))"
}
check D "a viewer cannot change the query limits" 403 "$(status controller PUT /fin-ledger/data-query/settings '{"maxRows":500}')"
check D "the tenant admin may query every table" "yes,yes" "$(can_query admin ledger_lake.ap.orders),$(can_query admin ledger_lake.hr.payroll)"
check D "a viewer sees the tables, locked" "no,no" "$(can_query controller ledger_lake.ap.orders),$(can_query controller ledger_lake.hr.payroll)"
check D "and is refused without a job" ":NO_QUERYABLE_TABLES" "$(run_code controller "SELECT * FROM ledger_lake.ap.orders")"
check D "a viewer cannot give data access" 403 "$(status controller POST /fin-ledger/access/grants "$(data_grant "$AP" data-reader asset "$ORDERS")")"
check D "a workspace admin gives the AP team one table" 201 "$(status admin POST /fin-ledger/access/grants "$(data_grant "$AP" data-reader asset "$ORDERS")")"
check D "only data-reader is given on a single table" 400 "$(status admin POST /fin-ledger/access/grants "$(data_grant "$AP" viewer asset "$ORDERS")")"
check D "and data engineering the whole source" 201 "$(status admin POST /fin-ledger/access/grants "$(data_grant "$DATA" data-reader source "$LAKE")")"
check D "the AP investigator may query that table only" "yes,no" "$(can_query investigator ledger_lake.ap.orders),$(can_query investigator ledger_lake.hr.payroll)"
check D "the other table is refused before any job" "ERROR:table_not_available" "$(run_code investigator "SELECT * FROM ledger_lake.hr.payroll")"
check D "files and table functions are refused too" "ERROR:function_not_allowed" "$(run_code investigator "SELECT * FROM read_csv('/etc/passwd')")"
check D "the source grant opens both tables" "yes,yes" "$(can_query engineer ledger_lake.ap.orders),$(can_query engineer ledger_lake.hr.payroll)"
check D "exporting needs data.export as well" ":EXPORT_NOT_ALLOWED" "$(run_code investigator "SELECT * FROM ledger_lake.ap.orders" xlsx)"
check D "the grants are listed with the workspace's" "asset,source" "$(get admin /fin-ledger/access/grants | json "print(','.join(sorted(g['scopeType'] for g in d if g['roleKey']=='data-reader')))")"
check D "another tenant gets 404" 404 "$(status outsider@globex GET /fin-ledger/data-query/catalog)"

say "notifications go to groups (docs/prd/IAM §6.4)"
pg "$DEFAULT_DB" "INSERT INTO $LEDGER_SCHEMA.notifications (id, type, severity, title, message, audience_group_ids, updated_at)
  VALUES ('00000000-0000-4000-8000-00000000a001', 'SCAN', 'INFO', 'to-owner', 'm', '{}', now()),
         ('00000000-0000-4000-8000-00000000a002', 'SOURCE', 'INFO', 'to-data', 'm', ARRAY['$DATA'], now())" >/dev/null
seen() { get "$1" /fin-ledger/notifications | json "print(','.join(sorted(n['title'] for n in d.get('notifications', []))) or '-')"; }
check N "the owning group gets what is sent to no group in particular" to-owner "$(seen controller)"
check N "so do members of its subgroups" to-owner "$(seen investigator)"
check N "a chosen group gets what is sent to it, and only that" to-data "$(seen engineer)"
check N "a role alone does not make anyone a recipient" - "$(seen admin)"
status controller PATCH /fin-ledger/notifications/00000000-0000-4000-8000-00000000a001/read >/dev/null
unread() { get "$1" /fin-ledger/notifications | json "print(d.get('unreadCount'))"; }
check N "reading it is each person's own" "0,1" "$(unread controller),$(unread investigator)"
check N "nobody marks what was not sent to them" 404 "$(status controller PATCH /fin-ledger/notifications/00000000-0000-4000-8000-00000000a002/read)"
check N "a viewer cannot choose who gets them" 403 "$(status controller PUT /fin-ledger/notifications/audiences/SCAN "{\"groupIds\":[\"$AP\"]}")"
check N "a workspace admin can" 200 "$(status admin PUT /fin-ledger/notifications/audiences/SCAN "{\"groupIds\":[\"$AP\"]}")"
check N "only groups of the tenant" 400 "$(status admin PUT /fin-ledger/notifications/audiences/SCAN '{"groupIds":["no-such-group"]}')"

say "public workspaces: read-only within their tenant (docs/prd/IAM step 8h)"
anon_slugs() { curl -s "$B/namespaces" | json "print(','.join(sorted(n['slug'] for n in d)) or '-')"; }
check W "without signing in nothing is listed while nothing is public" - "$(anon_slugs)"
check W "and a private workspace asks to sign in" 401 "$(status - GET /sales-pipeline/sources)"
check W "a viewer cannot make a workspace public" 403 "$(status controller PATCH "/namespaces/$WS_LEDGER" '{"public":true}')"
check W "a tenant admin can" 200 "$(status admin PATCH "/namespaces/$WS_SALES" '{"public":true}')"
check W "visitors then see it listed" sales-pipeline "$(anon_slugs)"
check W "and read it" 200 "$(status - GET /sales-pipeline/sources)"
check W "but change nothing: they are asked to sign in" 401 "$(status - POST /sales-pipeline/sources '{"name":"x","type":"LOCAL_FOLDER","config":{}}')"
check W "nor see who has access" 401 "$(status - GET /sales-pipeline/access/grants)"
check W "nor save SQL into a pool shared by every visitor" 401 "$(status - POST /sales-pipeline/saved-queries '{"name":"x","sql":"SELECT 1"}')"
check W "nor run SQL or even see its catalog" 401 "$(status - GET /sales-pipeline/data-query/catalog)"
check W "nor read who did what" 401 "$(status - GET /sales-pipeline/audit-events)"
check W "nor the settings" 401 "$(status - GET /sales-pipeline/instance-settings)"
check W "only how dates and language are shown" 200 "$(status - GET /sales-pipeline/instance-settings/display)"
check W "nor which AI providers are set up" 401 "$(status - GET /sales-pipeline/ai-provider-configs)"
check W "a member without a grant does not read its activity either" 403 "$(status controller GET /sales-pipeline/audit-events)"
check W "nor its settings" 403 "$(status controller GET /sales-pipeline/worker-queues)"
check W "a member of the tenant without a grant on it reads it" 200 "$(status controller GET /sales-pipeline/sources)"
check W "but cannot change it" 403 "$(status controller POST /sales-pipeline/sources '{"name":"x","type":"LOCAL_FOLDER","config":{}}')"
check W "another tenant never sees it" 404 "$(status outsider@globex GET /sales-pipeline/sources)"
check W "making it public is in the tenant's activity" workspace.published "$(pg classifyre_control "SELECT action FROM iam_audit_events WHERE action = 'workspace.published' LIMIT 1")"
status admin PATCH "/namespaces/$WS_SALES" '{"public":false}' >/dev/null
check W "private again, it closes at once" 401 "$(status - GET /sales-pipeline/sources)"

say "operator commands (docs/prd/TEN §4.9)"
check T0 "copies go only into a tenant" 2 "$(operator workspaces copy --to-local fin-q3 >/dev/null 2>&1; echo $?)"
check T0 "a copy into an unknown tenant is refused" 2 "$(operator workspaces copy --to-tenant nowhere --all >/dev/null 2>&1; echo $?)"
check T0 "an open database without workspaces has nothing to copy" "Nothing to copy to globex." "$(operator workspaces copy --to-tenant globex --all 2>&1 | tail -1)"

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
check P "tenants are not created through Classifyre" 404 "$(opstatus POST /platform/tenants '{"name":"Initech","alias":"initech"}')"
# An operator makes the tenant in the identity server: organization, admins group, first admin.
INITECH_ORG=$(kc '$K create organizations -r classifyre -s name=Initech -s alias=initech -s enabled=true -s "domains=[{\"name\":\"initech.example.test\"}]" -i')
BILL=$(kc '$K create users -r classifyre -s username=bill -s email=bill@example.test -s firstName=Bill -s lastName=Persona -s enabled=true -i')
kc "\$K create organizations/$INITECH_ORG/members -r classifyre -b '\"$BILL\"'" >/dev/null
INITECH_ADMINS=$(kc "\$K create organizations/$INITECH_ORG/groups -r classifyre -s name=admins -i")
kc "\$K update organizations/$INITECH_ORG/groups/$INITECH_ADMINS/members/$BILL -r classifyre -b '{}'" >/dev/null
check P "a tenant made in the identity server is listed, with its admin" bill@example.test "$(op GET /platform/tenants | json "print(next((t['admins'][0]['email'] for t in d if t['alias']=='initech' and t['admins']), 'missing'))")"
INITECH_ID=$(tenant_id initech)
GLOBEX_ID=$(tenant_id globex)
check P "suspending a tenant" suspended "$(op POST "/platform/tenants/$GLOBEX_ID/suspend" | json "print(d['status'])")"
check P "refuses its people" TENANT_SUSPENDED "$(get outsider /namespaces globex | json "print(d.get('code'))")"
op POST "/platform/tenants/$GLOBEX_ID/resume" >/dev/null
check P "and resuming lets them back in" 200 "$(status outsider@globex GET /namespaces)"
check P "the operator command makes a tenant's first workspace" "Created initech-ops in tenant initech." "$(operator workspaces create --tenant initech --slug initech-ops --owner-group "$INITECH_ADMINS" 2>&1 | tail -1)"
INITECH_DB="classifyre_t_${INITECH_ID//-/}"
check P "which gets the tenant its own database" "$INITECH_DB" "$(op GET /platform/tenants | json "print(next(t['database'] for t in d if t['alias']=='initech'))")"
check P "its data is not removed while its organization exists" ORGANIZATION_EXISTS "$(op DELETE "/platform/tenants/$INITECH_ID?confirm=initech" | json "print(d.get('code'))")"
kc "\$K delete organizations/$INITECH_ORG -r classifyre; \$K delete users/$BILL -r classifyre" >/dev/null
check P "an organization deleted in the identity server shows as missing" ORGANIZATION_MISSING "$(op GET /platform/tenants | json "print(next(t['problem'] for t in d if t['alias']=='initech'))")"
check P "nor without its alias typed" 400 "$(opstatus DELETE "/platform/tenants/$INITECH_ID?confirm=initec")"
check P "then its data is removed" 204 "$(opstatus DELETE "/platform/tenants/$INITECH_ID?confirm=initech")"
check P "it stays listed as deleted, alias reserved" deleted "$(op GET /platform/tenants | json "print(next(t['status'] for t in d if t['alias']=='initech'))")"
check P "with its database and workspaces gone" "0|0" "$(pg postgres "SELECT count(*) FROM pg_database WHERE datname = '$INITECH_DB'")|$(pg classifyre_control "SELECT count(*) FROM namespaces WHERE tenant_id = '$INITECH_ID'")"
check P "the workspace is in that tenant's activity" workspace.created "$(pg classifyre_control "SELECT action FROM iam_audit_events WHERE tenant_id = '$INITECH_ID' AND action LIKE 'workspace.%'")"
check P "globex's activity has the suspension and the resume" "tenant.resumed,tenant.suspended" "$(pg classifyre_control "SELECT string_agg(action, ',' ORDER BY action) FROM iam_audit_events WHERE tenant_id = '$GLOBEX_ID' AND action LIKE 'tenant.%'")"

say "results"
printf '%s\n' "${RESULTS[@]}"
if [ "$FAILED" = "1" ]; then echo "SOME CHECKS FAILED"; exit 1; fi
echo "all $(printf '%s\n' "${RESULTS[@]}" | grep -c PASS) checks passed"
