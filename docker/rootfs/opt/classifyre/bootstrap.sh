#!/usr/bin/env bash
# First-run workspace.
#
# A fresh Classifyre database has no workspaces, and nothing creates one — not
# the API, not the Helm chart. That is the right default for a cluster, where
# workspaces are provisioned deliberately, but for a container someone started
# to try the product out it means the first screen is empty with no obvious next
# step. So: if the registry is empty, make one.
#
# Runs as an s6 oneshot after the api service, and does nothing at all on every
# subsequent boot. Set CLASSIFYRE_BOOTSTRAP_NAMESPACE="" to skip it entirely.
set -euo pipefail

SLUG="${CLASSIFYRE_BOOTSTRAP_NAMESPACE:-}"
API="http://127.0.0.1:${API_PORT:-8000}"

log() { printf '[classifyre] bootstrap: %s\n' "$*" >&2; }

if [ -z "${SLUG}" ]; then
  log "CLASSIFYRE_BOOTSTRAP_NAMESPACE is empty, skipping"
  exit 0
fi

# The api service is "started" as soon as s6 forks it, but the process then
# applies migrations before it listens. On a first boot that is ~180 migrations
# against a cold database, so wait generously rather than racing it.
log "waiting for the API"
for _ in $(seq 1 600); do
  if curl -fsS "${API}/ping" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! curl -fsS "${API}/ping" >/dev/null 2>&1; then
  # Not fatal: the container is still perfectly usable, the operator just has to
  # create the workspace in the UI. Failing here would take the whole stack down
  # over a convenience.
  log "API never became ready; create a workspace in the UI instead"
  exit 0
fi

existing="$(curl -fsS "${API}/namespaces" 2>/dev/null || echo '')"
if [ -z "${existing}" ]; then
  log "could not read the workspace list; leaving bootstrap to the UI"
  exit 0
fi
# An empty registry is a bare `[]`, give or take whitespace. Anything else means
# the operator already has workspaces and this must not touch them.
if [ "$(printf '%s' "${existing}" | tr -d '[:space:]')" != "[]" ]; then
  log "workspaces already exist, nothing to do"
  exit 0
fi

# Title-cases the slug for the display name: "default" -> "Default".
NAME="${CLASSIFYRE_BOOTSTRAP_NAMESPACE_NAME:-$(printf '%s' "${SLUG}" | sed 's/[-_]/ /g; s/\b\(.\)/\u\1/g')}"

log "creating the '${SLUG}' workspace (provisions its schema and ~1,100 tables)"
# Build the body with python3 (this image's base interpreter) rather than
# interpolating into a JSON string — the name is operator-supplied.
body="$(NAME="${NAME}" SLUG="${SLUG}" python3 -c \
  'import json,os; print(json.dumps({"name": os.environ["NAME"], "slug": os.environ["SLUG"]}))')"

# --max-time is deliberately large: this call runs the full tenant migration
# chain, which is minutes on a slow laptop disk.
if curl -fsS --max-time 900 \
     -X POST "${API}/namespaces" \
     -H 'Content-Type: application/json' \
     -d "${body}" \
     >/dev/null; then
  log "workspace '${SLUG}' is ready at /${SLUG}"
else
  log "workspace creation failed; create one in the UI instead"
fi

exit 0
