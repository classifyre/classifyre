#!/usr/bin/env bash
# Persona checks for sign-in and access (docs/prd/IAM-access-management.md §7,
# step 8). Installs a throwaway release with sign-in on next to the dev stack,
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
IAM_PORT=8180
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
json() { python3 -c "import sys,json; d=json.loads(sys.stdin.read() or 'null', strict=False); $1"; }

check() { # check <case> <description> <expected> <actual>
  if [ "$3" = "$4" ]; then
    RESULTS+=("PASS  $1  $2")
  else
    RESULTS+=("FAIL  $1  $2 (expected $3, got $4)")
    FAILED=1
  fi
}

token() { # token <username> [tenant]
  curl -s -d client_id=persona-test -d "username=$1" -d password=persona-pass-1 \
    -d grant_type=password -d "scope=openid organization:${2:-default}" \
    "$KCURL/protocol/openid-connect/token" | json "print((d or {}).get('access_token',''))"
}
status() { # status <user[@tenant]|-> <method> <path> [body]
  local args=(-s -o /dev/null -w '%{http_code}' -X "$2" -H 'Content-Type: application/json')
  if [ "$1" != "-" ]; then
    args+=(-H "Authorization: Bearer $(token "${1%@*}" "$(tenant_of "$1")")")
  fi
  if [ $# -ge 4 ]; then args+=(-d "$4"); fi
  curl "${args[@]}" "$B$3"
}
# "user@tenant" -> tenant; plain "user" -> default.
tenant_of() { case "$1" in *@*) echo "${1#*@}" ;; *) echo default ;; esac; }
get() { curl -s -H "Authorization: Bearer $(token "$1" "${3:-default}")" "$B$2"; }
post() { curl -s -X POST -H "Authorization: Bearer $(token "$1")" -H 'Content-Type: application/json' -d "$3" "$B$2"; }
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
until kubectl -n "$NS" get pods --no-headers 2>/dev/null | grep -q "api.*1/1"; do sleep 10; done
until kubectl -n "$NS" get jobs --no-headers 2>/dev/null | grep -q Complete; do sleep 5; done
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

say "results"
printf '%s\n' "${RESULTS[@]}"
if [ "$FAILED" = "1" ]; then echo "SOME CHECKS FAILED"; exit 1; fi
echo "all $(printf '%s\n' "${RESULTS[@]}" | grep -c PASS) checks passed"
