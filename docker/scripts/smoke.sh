#!/usr/bin/env bash
#
# End-to-end smoke test for the all-in-one image.
#
# Boots the container and drives it the way a person would on their first
# evening with the product: wait for it to come up, check the UI and the docs
# are being served, point a source at a folder, run a scan, and see whether a
# finding comes out. That last step is the one that matters — it exercises the
# Python subprocess, the detector pool and the REST callback into the API, none
# of which a health check touches.
#
# Then restarts the container, because "it works until you restart it" is the
# failure mode a fresh-boot test cannot see.
#
#   IMAGE=classifyre/all-in-one:local bash docker/scripts/smoke.sh
#
# Environment:
#   IMAGE      image to test          (default classifyre/all-in-one:local)
#   PORT       host port to bind      (default 3300)
#   KEEP       1 to leave the container running afterwards, for poking at
#   BOOT_WAIT  seconds to wait for first boot (default 600)
#   SCAN_WAIT  seconds to wait for the scan  (default 900)

set -euo pipefail

IMAGE="${IMAGE:-classifyre/all-in-one:local}"
PORT="${PORT:-3300}"
CONTAINER="${CONTAINER:-classifyre-smoke}"
BOOT_WAIT="${BOOT_WAIT:-600}"
SCAN_WAIT="${SCAN_WAIT:-900}"
NS="${NS:-default}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BASE="http://127.0.0.1:${PORT}"
API="${BASE}/api"

step()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()    { printf '    \033[32mok\033[0m  %s\n' "$*"; }
fail()  { printf '    \033[31mFAIL\033[0m %s\n' "$*" >&2; exit 1; }

for tool in docker curl python3; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is required"
done

TMP_DIR="$(mktemp -d)"
cleanup() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    # The interesting lines are rarely the last ones: a first boot prints every
    # migration it applies, which buries a scan failure hundreds of lines up.
    # Pull the errors out first, then the tail for context.
    printf '\n\033[31m--- errors and scan output ---\033[0m\n' >&2
    docker logs "${CONTAINER}" 2>&1 \
      | grep -aiE "\[CLI\]|ERROR|FATAL|Traceback|exited with code|uv sync|Timed out" \
      | grep -avE "RouterExplorer|Mapped \{" | tail -40 >&2 || true
    printf '\n\033[31m--- last 60 lines ---\033[0m\n' >&2
    docker logs --tail 60 "${CONTAINER}" >&2 2>&1 || true
  fi
  if [ "${KEEP:-0}" = "1" ] && [ "$code" -eq 0 ]; then
    printf '\nContainer left running at %s (KEEP=1)\n' "${BASE}"
  else
    docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  fi
  # Everything under the mounts was written by uids *inside* the container —
  # postgres for the cluster, 10001 for the app — which on Linux the host user
  # cannot delete. (On macOS, Docker Desktop maps ownership and plain rm works,
  # which is how this hid.) Empty it from inside a container that can, then take
  # the directory itself. Never fatal: the test's verdict is already decided by
  # this point, and a teardown that cannot tidy up must not turn a pass into a
  # failure.
  docker run --rm --entrypoint sh -v "${TMP_DIR}:/cleanup" "${IMAGE}" \
    -c 'rm -rf /cleanup/* /cleanup/.[!.]*' >/dev/null 2>&1 || true
  rm -rf "${TMP_DIR}" 2>/dev/null || true
  exit "$code"
}
trap cleanup EXIT

# Reads a value out of a JSON document on stdin by dotted path — `total`,
# `0.slug`. Beats grepping a JSON blob, and prints nothing (rather than failing)
# when the path is absent, so callers can test for empty.
jget() {
  python3 -c '
import json, sys
value = json.load(sys.stdin)
for key in sys.argv[1].split("."):
    if key == "":
        continue
    try:
        value = value[int(key)] if key.lstrip("-").isdigit() else value[key]
    except (KeyError, IndexError, TypeError):
        sys.exit(0)
print(value)
' "$1"
}

# Number of elements in a JSON array on stdin.
jlen() { python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'; }

# Any non-2xx prints the status and the response body before failing. `curl -f`
# alone just exits 22, which tells you nothing about *why* the API said no.
#
# The JSON content-type is added only when there is actually a body: Fastify
# rejects `Content-Type: application/json` with an empty payload outright
# ("Body cannot be empty..."), which is what a bodyless POST like /runs is.
api() {
  local method="$1" path="$2"; shift 2
  local body status has_body=0 arg
  for arg in "$@"; do
    case "${arg}" in -d|--data|--data-*) has_body=1 ;; esac
  done
  local -a headers=()
  [ "${has_body}" = "1" ] && headers=(-H 'Content-Type: application/json')

  body="$(curl -sS -w '\n%{http_code}' -X "${method}" "${API}${path}" \
    "${headers[@]+"${headers[@]}"}" "$@")"
  status="${body##*$'\n'}"
  body="${body%$'\n'*}"
  case "${status}" in
    2*) printf '%s' "${body}" ;;
    *)  fail "${method} ${path} -> HTTP ${status}: ${body}" ;;
  esac
}

# ── Boot ──────────────────────────────────────────────────────────────────────
step "Starting ${IMAGE}"
docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
mkdir -p "${TMP_DIR}"/{pgdata,data,uv-cache}
chmod -R 0777 "${TMP_DIR}"

docker run -d --name "${CONTAINER}" \
  -p "${PORT}:3000" \
  --shm-size=1g \
  -v "${TMP_DIR}/pgdata:/var/lib/postgresql/data" \
  -v "${TMP_DIR}/data:/var/lib/classifyre" \
  -v "${TMP_DIR}/uv-cache:/cache/uv" \
  -v "${DOCKER_DIR}/fixtures/smoke:/data/smoke:ro" \
  "${IMAGE}" >/dev/null
ok "container started on :${PORT}"

step "Waiting for the API (first boot runs every migration)"
for _ in $(seq 1 "${BOOT_WAIT}"); do
  if curl -fsS "${API}/ping" >/dev/null 2>&1; then break; fi
  if ! docker ps --filter "name=${CONTAINER}" --filter status=running -q | grep -q .; then
    fail "container exited during boot"
  fi
  sleep 1
done
curl -fsS "${API}/ping" >/dev/null || fail "API never answered on ${API}/ping"
ok "API is up"

# ── What the container serves ─────────────────────────────────────────────────
step "Checking the routes"
curl -fsS -o /dev/null "${BASE}/" || fail "the web UI did not answer at /"
ok "web UI at /"

curl -fsS -o /dev/null "${BASE}/docs/" || fail "the bundled docs site did not answer at /docs/"
ok "docs site at /docs/"

# Swagger lives at /docs on the API. It must not shadow, or be shadowed by, the
# documentation site the web app serves at the same path.
curl -fsS -o /dev/null "${API}/docs" || fail "Swagger did not answer at /api/docs"
ok "Swagger at /api/docs (no collision with the docs site)"

# ── Bootstrap workspace ───────────────────────────────────────────────────────
# Must come before the database checks: pgvector and the tenant tables are
# created by the *tenant* migrations, which only run once a workspace exists.
# The API answers /ping well before that finishes, so poll rather than assume.
step "Waiting for the first-run workspace"
namespaces=""
for _ in $(seq 1 "${BOOT_WAIT}"); do
  namespaces="$(api GET /namespaces 2>/dev/null || echo '[]')"
  [ "$(printf '%s' "${namespaces}" | jlen)" -ge 1 ] && break
  sleep 2
done
count="$(printf '%s' "${namespaces}" | jlen)"
[ "${count:-0}" -ge 1 ] || fail "no workspace was created on first boot"
slug="$(printf '%s' "${namespaces}" | jget "0.slug")"
[ "${slug}" = "${NS}" ] || fail "expected a workspace named '${NS}', found '${slug}'"
ok "workspace '${slug}' exists"

# ── Database ──────────────────────────────────────────────────────────────────
step "Checking the database"
docker exec "${CONTAINER}" psql -U postgres -d classifyre -tAc \
  "SELECT 1 FROM pg_extension WHERE extname='vector'" | grep -q 1 \
  || fail "the pgvector extension is not installed — semantic search and duplicate review will not work"
ok "pgvector installed"

# The workspace row is inserted before its schema is migrated, so the API can
# list it while the tenant tables are still being created. Wait for the count to
# settle rather than sampling once. (One workspace is ~83 tables; the floor is a
# sanity check, not an exact expectation.)
tables=0
for _ in $(seq 1 60); do
  tables="$(docker exec "${CONTAINER}" psql -U postgres -d classifyre -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema LIKE 'ns\_%'" \
    | tr -d '[:space:]')"
  [ "${tables:-0}" -ge 50 ] && break
  sleep 5
done
[ "${tables:-0}" -ge 50 ] \
  || fail "workspace schema never finished provisioning (${tables} tables)"
ok "workspace schema provisioned (${tables} tables)"

# ── A real scan ───────────────────────────────────────────────────────────────
step "Scanning the fixture corpus"

# Touch the workspace first, and let it settle. A namespace does its runner
# reconciliation when it is first resolved, and that sweep marks every
# PENDING/RUNNING runner it cannot see executing as orphaned — including one
# created a moment earlier by a client faster than any human. Resolving the
# namespace here means the sweep has happened before a runner exists to catch.
api GET "/${NS}/sources" >/dev/null
sleep 10

source_id="$(api POST "/${NS}/sources" -d '{
  "type": "LOCAL_FOLDER",
  "name": "Smoke fixture",
  "config": {
    "type": "LOCAL_FOLDER",
    "required": { "path": "/data/smoke" },
    "sampling": { "strategy": "ALL" },
    "detectors": [{ "type": "SECRETS", "enabled": true }]
  }
}' | jget "id")"
ok "source created (${source_id})"

api POST "/${NS}/sources/${source_id}/runs" >/dev/null
ok "scan started"

# The first scan installs the detector's Python dependency group into the uv
# cache, so this is slower than every later run.
status=""
for _ in $(seq 1 "${SCAN_WAIT}"); do
  status="$(api GET "/${NS}/sources/${source_id}" | jget runnerStatus 2>/dev/null || echo '')"
  case "${status}" in
    COMPLETED|FAILED|CANCELLED|ERROR) break ;;
  esac
  sleep 1
done
[ "${status}" = "COMPLETED" ] || fail "scan ended as '${status}', expected COMPLETED"
ok "scan completed"

# /findings/stats answers from a rollup table refreshed on its own schedule, so
# a correct scan can still report zero for a few seconds after it completes.
# Poll rather than sampling once — the assertion is "findings arrive", not
# "findings are already in the rollup the instant the runner goes COMPLETED".
findings=0
for _ in $(seq 1 60); do
  findings="$(api GET "/${NS}/findings/stats?sourceId=${source_id}" | jget total)"
  [ "${findings:-0}" -ge 1 ] && break
  sleep 5
done
[ "${findings:-0}" -ge 1 ] \
  || fail "the scan produced no findings — extraction, the detector pool, or the REST callback is broken"
ok "${findings} finding(s) recorded"

# Logs land on disk unless S3 is configured. A silently-empty log directory is
# how the RUNNER_LOG_DIR/RUNNER_LOGS_DIR naming mismatch hid on Kubernetes.
docker exec "${CONTAINER}" sh -c '[ -n "$(ls -A /var/lib/classifyre/runner-logs 2>/dev/null)" ]' \
  || fail "no scan logs were persisted to RUNNER_LOG_DIR"
ok "scan logs persisted"

# ── Restart durability ────────────────────────────────────────────────────────
step "Restarting the container"
key_before="$(docker exec "${CONTAINER}" cat /var/lib/classifyre/masked-config.key)"
docker restart "${CONTAINER}" >/dev/null

for _ in $(seq 1 "${BOOT_WAIT}"); do
  if curl -fsS "${API}/ping" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "${API}/ping" >/dev/null || fail "the API did not come back after a restart"

key_after="$(docker exec "${CONTAINER}" cat /var/lib/classifyre/masked-config.key)"
[ "${key_before}" = "${key_after}" ] \
  || fail "the credential encryption key was regenerated — every stored credential would now be unreadable"
ok "credential key survived the restart"

after="$(api GET "/${NS}/findings/stats?sourceId=${source_id}" | jget total)"
[ "${after}" = "${findings}" ] || fail "findings changed across a restart (${findings} -> ${after})"
ok "data survived the restart (${after} findings)"

printf '\n\033[32mSmoke test passed\033[0m for %s\n' "${IMAGE}"
