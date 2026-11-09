#!/usr/bin/env bash
#
# End-to-end smoke test for the all-in-one image: the same Playwright smoke
# test the Helm release runs (apps/e2e/tests/smoke.spec.ts), against a fresh
# container.
#
# Boots the container, waits for it, checks what it serves, seeds two people in
# its identity server (scripts/smoke/seed.sh), runs the smoke test (sign in,
# create a workspace, scan a folder, access, SQL, notifications), then restarts
# the container and checks the workspace and its findings survived — "it works
# until you restart it" is the failure a fresh-boot test cannot see.
#
#   IMAGE=classifyre/all-in-one:local bash docker/scripts/smoke.sh
#
# Needs docker, curl, python3 and bun with the e2e workspace installed
# (`bun install --filter @classifyre/e2e`, `bunx playwright install chromium`).
#
# Environment:
#   IMAGE      image to test          (default classifyre/all-in-one:local)
#   PORT       host port to bind      (default 3300)
#   KEEP       1 to leave the container running afterwards, for poking at
#   BOOT_WAIT  seconds to wait for first boot (default 900)

set -euo pipefail

IMAGE="${IMAGE:-classifyre/all-in-one:local}"
PORT="${PORT:-3300}"
CONTAINER="${CONTAINER:-classifyre-smoke}"
BOOT_WAIT="${BOOT_WAIT:-900}"
NS="${NS:-default}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT="$(cd "${DOCKER_DIR}/.." && pwd)"
# The address the browser opens must be the one the identity server was told
# (CLASSIFYRE_URL): it signs tokens for it and only redirects back to it.
BASE="http://localhost:${PORT}"
API="${BASE}/api"

step()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()    { printf '    \033[32mok\033[0m  %s\n' "$*"; }
fail()  { printf '    \033[31mFAIL\033[0m %s\n' "$*" >&2; exit 1; }

for tool in docker curl python3 bun; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is required"
done

TMP_DIR="$(mktemp -d)"
cleanup() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    # The interesting lines are rarely the last ones: a first boot prints every
    # migration it applies, which buries a failure hundreds of lines up.
    printf '\n\033[31m--- errors ---\033[0m\n' >&2
    docker logs "${CONTAINER}" 2>&1 \
      | grep -aiE "\[CLI\]|ERROR|FATAL|Traceback|exited with code|Timed out|bootstrap:|iam:" \
      | grep -avE "RouterExplorer|Mapped \{" | tail -60 >&2 || true
    printf '\n\033[31m--- last 60 lines ---\033[0m\n' >&2
    docker logs --tail 60 "${CONTAINER}" >&2 2>&1 || true
  fi
  if [ "${KEEP:-0}" = "1" ] && [ "$code" -eq 0 ]; then
    printf '\nContainer left running at %s (KEEP=1)\n' "${BASE}"
  else
    docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  fi
  rm -f "${ROOT}/apps/e2e/.env"
  # Everything under the mounts was written by uids *inside* the container —
  # postgres for the cluster, 10001 for the app — which on Linux the host user
  # cannot delete. Empty it from inside a container that can, then take the
  # directory itself. Never fatal: the verdict is already decided by now.
  docker run --rm --entrypoint sh -v "${TMP_DIR}:/cleanup" "${IMAGE}" \
    -c 'rm -rf /cleanup/* /cleanup/.[!.]*' >/dev/null 2>&1 || true
  rm -rf "${TMP_DIR}" 2>/dev/null || true
  exit "$code"
}
trap cleanup EXIT

psql_in() { # psql_in <database> <sql>: one value, as the bundled superuser
  docker exec "${CONTAINER}" psql -U postgres -d "$1" -tAc "$2" | tr -d '[:space:]'
}

wait_for() { # wait_for <what> <seconds> <command...>
  local what=$1 seconds=$2; shift 2
  for _ in $(seq 1 "${seconds}"); do
    "$@" >/dev/null 2>&1 && return 0
    if ! docker ps --filter "name=${CONTAINER}" --filter status=running -q | grep -q .; then
      fail "the container exited while waiting for ${what}"
    fi
    sleep 1
  done
  fail "${what} did not come up in ${seconds}s"
}

# ── Boot ──────────────────────────────────────────────────────────────────────
step "Starting ${IMAGE}"
docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
mkdir -p "${TMP_DIR}"/{pgdata,data,uv-cache}
chmod -R 0777 "${TMP_DIR}"

docker run -d --name "${CONTAINER}" \
  -p "${PORT}:3000" \
  -e CLASSIFYRE_URL="${BASE}" \
  --shm-size=1g \
  -v "${TMP_DIR}/pgdata:/var/lib/postgresql/data" \
  -v "${TMP_DIR}/data:/var/lib/classifyre" \
  -v "${TMP_DIR}/uv-cache:/cache/uv" \
  -v "${DOCKER_DIR}/fixtures/smoke:/data/smoke:ro" \
  "${IMAGE}" >/dev/null
ok "container started on :${PORT}"

step "Waiting for the API (first boot runs every migration)"
wait_for "the API" "${BOOT_WAIT}" curl -fsS "${API}/ping"
ok "API is up"

step "Waiting for the identity server and its realm"
wait_for "the sign-in realm" "${BOOT_WAIT}" \
  curl -fsS "${BASE}/iam/realms/classifyre/.well-known/openid-configuration"
ok "realm classifyre answers at ${BASE}/iam"

step "Waiting for the first-run workspace"
wait_for "the '${NS}' workspace" "${BOOT_WAIT}" \
  sh -c "[ \"\$(docker exec ${CONTAINER} psql -U postgres -d classifyre_control -tAc \"SELECT count(*) FROM namespaces WHERE slug = '${NS}' AND status = 'active'\" | tr -d '[:space:]')\" = 1 ]"
ok "workspace '${NS}' exists in the first tenant"

# ── What the container serves ─────────────────────────────────────────────────
step "Checking the routes"
# Without a session the app sends people to sign in.
status="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/")"
[ "${status}" = "307" ] || [ "${status}" = "302" ] || fail "/ answered ${status}, not a redirect to sign in"
ok "/ sends people to sign in"
curl -fsS -o /dev/null "${BASE}/docs/" || fail "the bundled docs site did not answer at /docs/"
ok "docs site at /docs/"
# Swagger lives at /docs on the API. It must not shadow, or be shadowed by, the
# documentation site the web app serves at the same path.
curl -fsS -o /dev/null "${API}/docs" || fail "Swagger did not answer at /api/docs"
ok "Swagger at /api/docs (no collision with the docs site)"
status="$(curl -s -o /dev/null -w '%{http_code}' "${API}/namespaces")"
[ "${status}" = "401" ] || fail "/api/namespaces answered ${status} without a session, not 401"
ok "the API asks for sign-in"

# ── Database ──────────────────────────────────────────────────────────────────
step "Checking the databases"
tenant_db="$(psql_in classifyre_control "SELECT database_name FROM iam_tenants WHERE alias = 'default'")"
[ -n "${tenant_db}" ] || fail "the first tenant has no database"
ok "the first tenant has its own database (${tenant_db})"
[ "$(psql_in "${tenant_db}" "SELECT 1 FROM pg_extension WHERE extname='vector'")" = 1 ] \
  || fail "the pgvector extension is not installed — semantic search and duplicate review will not work"
ok "pgvector installed"

# ── The smoke test ────────────────────────────────────────────────────────────
RUN="docker$(date +%s)"
step "Seeding the identity server"
SMOKE_TARGET=docker CONTAINER="${CONTAINER}" BASE_URL="${BASE}" \
  bash "${ROOT}/scripts/smoke/seed.sh"

step "Running the Playwright smoke test"
(cd "${ROOT}/apps/e2e" && SMOKE_RUN="${RUN}" SMOKE_KEEP_WORKSPACE=1 bunx playwright test)
ok "smoke test passed"

docker exec "${CONTAINER}" sh -c '[ -n "$(ls -A /var/lib/classifyre/runner-logs 2>/dev/null)" ]' \
  || fail "no scan logs were persisted to RUNNER_LOG_DIR"
ok "scan logs persisted"

# ── Restart durability ────────────────────────────────────────────────────────
step "Restarting the container"
key_before="$(docker exec "${CONTAINER}" cat /var/lib/classifyre/masked-config.key)"
secrets_before="$(docker exec "${CONTAINER}" cat /var/lib/classifyre/iam.secrets)"
docker restart "${CONTAINER}" >/dev/null
wait_for "the API after a restart" "${BOOT_WAIT}" curl -fsS "${API}/ping"
wait_for "the realm after a restart" "${BOOT_WAIT}" \
  curl -fsS "${BASE}/iam/realms/classifyre/.well-known/openid-configuration"
[ "${key_before}" = "$(docker exec "${CONTAINER}" cat /var/lib/classifyre/masked-config.key)" ] \
  || fail "the credential encryption key was regenerated — every stored credential would now be unreadable"
[ "${secrets_before}" = "$(docker exec "${CONTAINER}" cat /var/lib/classifyre/iam.secrets)" ] \
  || fail "the sign-in secrets were regenerated — tenant databases would no longer open"
ok "keys survived the restart"

(cd "${ROOT}/apps/e2e" && SMOKE_RUN="${RUN}" SMOKE_AFTER_RESTART=1 bunx playwright test --grep @after-restart)
ok "the workspace and its findings survived the restart"

printf '\n\033[32mSmoke test passed\033[0m for %s\n' "${IMAGE}"
