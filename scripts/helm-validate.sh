#!/usr/bin/env bash
# Validate critical security and correctness invariants in the rendered Helm chart.
# Run after helm-lint.sh and before deploying.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CHART_DIR="${CHART_DIR:-${REPO_ROOT}/helm/classifyre}"
HELM_COMMON_ARGS=(
  --set "postgres.external.password=${POSTGRES_EXTERNAL_PASSWORD:-snapshot-password}"
  --set "api.maskedConfigEncryption.value=${CLASSIFYRE_MASKED_CONFIG_KEY:-snapshot-classifyre-masked-key-0001}"
  --set "ingress.host=validate.example.com"
)

if ! command -v helm >/dev/null 2>&1; then
  echo "helm is required." >&2
  exit 1
fi

PASS=0
FAIL=0

assert_contains() {
  local description="$1"
  local pattern="$2"
  local rendered="$3"
  if echo "${rendered}" | grep -qF "${pattern}"; then
    echo "  ✓ ${description}"
    PASS=$((PASS + 1))
  else
    echo "  ✗ ${description} — expected to find: ${pattern}"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local description="$1"
  local pattern="$2"
  local rendered="$3"
  if ! echo "${rendered}" | grep -qF "${pattern}"; then
    echo "  ✓ ${description}"
    PASS=$((PASS + 1))
  else
    echo "  ✗ ${description} — expected NOT to find: ${pattern}"
    FAIL=$((FAIL + 1))
  fi
}

run_checks() {
  local label="$1"
  local values_file="$2"
  local rendered
  # Always render with embedded postgres so the Deployment is present to validate.
  rendered="$(helm template classifyre "${CHART_DIR}" -f "${values_file}" "${HELM_COMMON_ARGS[@]}" \
    --set postgres.mode=embedded --set postgres.embedded.password=validate-password)"

  echo ""
  echo "── ${label} ──"

  # ── CLI job: non-root writable PVC mounts ─────────────────────────────────
  # fsGroup:10001 ensures Kubernetes pre-chowns PVCs (uv-cache, playwright-cache,
  # runner-logs) so uid 10001 can write on fresh installs.
  assert_contains \
    "CLI job podSecurityContext sets fsGroup: 10001" \
    "fsGroup: 10001" \
    "${rendered}"

  assert_contains \
    "CLI job podSecurityContext sets runAsUser: 10001" \
    "runAsUser: 10001" \
    "${rendered}"

  # ── CLI job: crawl4ai writable home ───────────────────────────────────────
  # crawl4ai calls Path.home() at import time; without HOME=/tmp it resolves to
  # '/' (no /etc/passwd entry for uid 10001) and fails to mkdir /.crawl4ai.
  assert_contains \
    "CLI job env includes CRAWL4_AI_BASE_DIRECTORY=/tmp" \
    "CRAWL4_AI_BASE_DIRECTORY" \
    "${rendered}"

  assert_contains \
    "CLI job env includes HOME=/tmp" \
    '"HOME"' \
    "${rendered}"

  # ── Postgres embedded: non-root startup ───────────────────────────────────
  # postgres:18 entrypoint skips chmod when already running as uid 999.
  # Without runAsUser:999 it tries to chmod the data dir and fails with
  # allowPrivilegeEscalation:false + drop ALL caps.
  assert_contains \
    "Postgres podSecurityContext sets runAsUser: 999" \
    "runAsUser: 999" \
    "${rendered}"

  assert_contains \
    "Postgres podSecurityContext sets fsGroup: 999" \
    "fsGroup: 999" \
    "${rendered}"

  # ── Postgres: no privilege escalation ─────────────────────────────────────
  assert_contains \
    "Postgres containerSecurityContext disallows privilege escalation" \
    "allowPrivilegeEscalation: false" \
    "${rendered}"
}

run_checks "default values" "${CHART_DIR}/values.yaml"
run_checks "minikube values" "${CHART_DIR}/values-minikube.yaml"

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
if [[ "${FAIL}" -gt 0 ]]; then
  exit 1
fi
echo "Helm validation passed."
