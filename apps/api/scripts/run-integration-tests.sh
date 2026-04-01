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

if [[ "${INTEGRATION_TEST_RESET_DB:-0}" == "1" ]]; then
  echo "Resetting integration database..."
  bunx prisma migrate reset --force
else
  echo "Applying pending migrations..."
  bun run prisma:deploy
fi

echo "Running API integration tests..."
exec bun run test:integration
