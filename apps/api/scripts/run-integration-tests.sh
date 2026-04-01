#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

load_env_file() {
  local file="$1"
  if [[ -f "${file}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${file}"
    set +a
  fi
}

cd "${APP_DIR}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  load_env_file "${APP_DIR}/.env"
  load_env_file "${APP_DIR}/.env.test"
  load_env_file "${APP_DIR}/.env.test.local"
else
  echo "Using DATABASE_URL from environment."
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set for integration tests." >&2
  exit 1
fi

if [[ -z "${INTEGRATION_TEST_SCHEMA_KEY:-}" ]]; then
  if [[ -n "${GITHUB_HEAD_REF:-}" ]]; then
    INTEGRATION_TEST_SCHEMA_KEY="${GITHUB_HEAD_REF}"
  elif [[ -n "${GITHUB_REF_NAME:-}" ]]; then
    INTEGRATION_TEST_SCHEMA_KEY="${GITHUB_REF_NAME}"
  else
    INTEGRATION_TEST_SCHEMA_KEY="$(git branch --show-current 2>/dev/null || true)"
  fi
fi

cleanup_schema() {
  if [[ -z "${INTEGRATION_TEST_SCHEMA:-}" ]]; then
    return
  fi

  echo "Dropping integration schema ${INTEGRATION_TEST_SCHEMA}..."
  DATABASE_URL="${BASE_DATABASE_URL}" \
    INTEGRATION_TEST_SCHEMA="${INTEGRATION_TEST_SCHEMA}" \
    bun run ./scripts/manage-integration-schema.ts cleanup || true
}

BASE_DATABASE_URL="${DATABASE_URL}"
if [[ -n "${INTEGRATION_TEST_SCHEMA_KEY:-}" ]]; then
  echo "Preparing isolated integration schema from key: ${INTEGRATION_TEST_SCHEMA_KEY}"
  eval "$(
    DATABASE_URL="${BASE_DATABASE_URL}" \
      INTEGRATION_TEST_SCHEMA_KEY="${INTEGRATION_TEST_SCHEMA_KEY}" \
      bun run ./scripts/manage-integration-schema.ts prepare
  )"
  trap cleanup_schema EXIT
  echo "Using integration schema ${INTEGRATION_TEST_SCHEMA}"
fi

if [[ "${INTEGRATION_TEST_RESET_DB:-0}" == "1" ]]; then
  echo "Resetting integration database..."
  bunx prisma migrate reset --force
else
  echo "Applying pending migrations..."
  bun run prisma:deploy
fi

echo "Running API integration tests..."
bun run test:integration
