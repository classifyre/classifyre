#!/usr/bin/env bash
# Run the CI workflow locally using act (https://github.com/nektos/act).
#
# Builds all Docker images (api, web, cli, all-in-one) and pushes them to
# Docker Hub with the :main tag — same as what GitHub CI does on a push to main.
#
# Prerequisites:
#   brew install act
#   gh auth login   (or export GITHUB_TOKEN=ghp_...)
#   Docker Desktop running
#
# Usage:
#   ./scripts/ci-local.sh              # run full pipeline
#   ./scripts/ci-local.sh -j validate  # only the validate job
#   ./scripts/ci-local.sh -j docker    # only the docker build jobs

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

source "${REPO_ROOT}/scripts/lib/load-secrets.sh"
load_repo_secrets "${REPO_ROOT}"

# ── Resolve GitHub token ──────────────────────────────────────────────────────
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  if command -v gh >/dev/null 2>&1; then
    GITHUB_TOKEN="$(gh auth token 2>/dev/null || true)"
  fi
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Error: GITHUB_TOKEN not set." >&2
  echo "Run:  gh auth login   or   export GITHUB_TOKEN=ghp_..." >&2
  exit 1
fi

# ── Resolve Docker Hub credentials ────────────────────────────────────────────
DOCKER_USERNAME="${DOCKER_USERNAME:-}"
DOCKERHUB_TOKEN="${DOCKERHUB_TOKEN:-}"

if [[ -z "${DOCKER_USERNAME}" || -z "${DOCKERHUB_TOKEN}" ]]; then
  echo "Error: DOCKER_USERNAME and DOCKERHUB_TOKEN must be set." >&2
  echo "Add them to ${REPO_ROOT}/.secrets or export them before running this script." >&2
  exit 1
fi

# ── Ensure artifact scratch directory exists ──────────────────────────────────
mkdir -p /tmp/act-artifacts

# ── Write event payload so act sets github.event_name=workflow_dispatch ──────
# Without this, act can resolve the event to 'workflow_call' (act quirk when the
# workflow has both workflow_dispatch and workflow_call triggers), which causes
# the docker jobs' `if: github.event_name != 'workflow_call'` check to skip them.
EVENT_FILE="/tmp/act-event-dispatch.json"
echo '{"inputs":{}}' > "${EVENT_FILE}"

ACT_SECRET_ARGS=(
  -s "GITHUB_TOKEN=${GITHUB_TOKEN}"
  -s "DOCKER_USERNAME=${DOCKER_USERNAME}"
  -s "DOCKERHUB_TOKEN=${DOCKERHUB_TOKEN}"
)

run_act() {
  local label="$1"
  shift

  local act_log
  act_log="$(mktemp -t ci-local-act)"

  echo ""
  echo "Running (${label}): act workflow_dispatch -W .github/workflows/ci.yml $*"
  echo ""

  set +e
  act workflow_dispatch \
    -W .github/workflows/ci.yml \
    -e "${EVENT_FILE}" \
    --artifact-server-path /tmp/act-artifacts \
    --env DOCKER_PLATFORMS=linux/amd64 \
    "${ACT_SECRET_ARGS[@]}" \
    "$@" 2>&1 | tee "${act_log}"
  local act_exit=${PIPESTATUS[0]}
  set -e

  if [[ ${act_exit} -ne 0 ]] \
    && grep -q 'context deadline exceeded' "${act_log}" \
    && ! grep -q 'Job failed' "${act_log}" \
    && grep -q '🏁  Job succeeded' "${act_log}"; then
    echo ""
    echo "act hit a known cleanup timeout after the workflow succeeded; treating run as successful."
    docker volume ls --format '{{.Name}}' | rg '^act-' | xargs -r docker volume rm >/dev/null 2>&1 || true
    act_exit=0
  fi

  rm -f "${act_log}"
  return "${act_exit}"
}

has_explicit_job=false
for arg in "$@"; do
  if [[ "${arg}" == "-j" || "${arg}" == "--job" ]]; then
    has_explicit_job=true
    break
  fi
done

if [[ "${has_explicit_job}" == "true" ]]; then
  run_act "custom" "$@"
  exit $?
fi

rm -rf /tmp/act-artifacts/*
run_act "validate" -j validate "$@"
run_act "docker" -j docker "$@"
