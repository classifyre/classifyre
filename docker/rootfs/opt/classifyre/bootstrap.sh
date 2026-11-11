#!/usr/bin/env bash
# First-run workspace, and the "ready" banner.
#
# A fresh install has no workspaces, and nothing creates one — not the API,
# not the Helm chart. That is the right default for a cluster, where
# workspaces are provisioned deliberately, but for a container someone started
# to try the product out it means the first screen is empty with no obvious
# next step. So: on the first boot, make one in the first tenant, owned by its
# admins group (which the admin is in).
#
# Runs as an s6 oneshot after the api service and the realm setup. A marker in
# the data volume keeps it from re-creating a workspace someone deleted on
# purpose. Set CLASSIFYRE_BOOTSTRAP_NAMESPACE="" to skip it.
set -euo pipefail

SLUG="${CLASSIFYRE_BOOTSTRAP_NAMESPACE:-}"
API="http://127.0.0.1:${API_PORT:-8000}"
MARKER=/var/lib/classifyre/bootstrap.done

log() { printf '[classifyre] bootstrap: %s\n' "$*" >&2; }

ready() {
  local password="the one you set in CLASSIFYRE_ADMIN_PASSWORD"
  [ "${CLASSIFYRE_ADMIN_PASSWORD}" = "classifyre" ] && password="classifyre"
  cat >&2 <<MSG

[classifyre] ─────────────────────────────────────────────────────────────
[classifyre]  Classifyre is ready at ${CLASSIFYRE_URL}
[classifyre]  Sign in as ${CLASSIFYRE_ADMIN_USER}, password ${password}.
[classifyre]  Change it after signing in: account menu → Your account → Signing in.
[classifyre] ─────────────────────────────────────────────────────────────

MSG
}

# The api service is "started" as soon as s6 forks it, but the process then
# applies migrations before it listens, and sets up the first tenant once the
# identity server answers. On a first boot that is minutes, so wait
# generously rather than racing it.
log "waiting for the API"
for _ in $(seq 1 600); do
  curl -fsS "${API}/ping" >/dev/null 2>&1 && break
  sleep 1
done

if [ -z "${SLUG}" ] || [ -e "${MARKER}" ]; then
  [ -z "${SLUG}" ] && log "CLASSIFYRE_BOOTSTRAP_NAMESPACE is empty, skipping"
  ready
  exit 0
fi

# Title-cases the slug for the display name: "default" -> "Default".
NAME="${CLASSIFYRE_BOOTSTRAP_NAMESPACE_NAME:-$(printf '%s' "${SLUG}" | sed 's/[-_]/ /g; s/\b\(.\)/\u\1/g')}"

admin() {
  (cd /app/api && s6-setuidgid classifyre node dist/src/admin.js "$@")
}

# The tenant row appears once the API has set up sign-in; retry until then.
log "creating the '${SLUG}' workspace (provisions its schema and ~1,100 tables)"
out=""
for _ in $(seq 1 60); do
  if out=$(admin workspaces create --tenant "${IAM_BOOTSTRAP_TENANT:-default}" \
        --slug "${SLUG}" --name "${NAME}" 2>&1); then
    log "${out##*$'\n'}"
    touch "${MARKER}"
    break
  fi
  sleep 10
done
if [ ! -e "${MARKER}" ]; then
  # Not fatal: the container is still usable, the person just creates the
  # workspace in the UI.
  log "could not create the workspace (${out##*$'\n'}); create one in the UI instead"
fi

ready
exit 0
