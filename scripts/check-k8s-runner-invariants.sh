#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-classifyre}"
RELEASE="${RELEASE:-classifyre}"
API_DEPLOYMENT="${API_DEPLOYMENT:-${RELEASE}-api}"
MODE="check"

if [[ "${1:-}" == "--repair" ]]; then
  MODE="repair"
fi

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required." >&2
  exit 1
fi

read -r -d '' NODE_SCRIPT <<'NODE' || true
const { PrismaClient, RunnerStatus } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const mode = process.env.CLASSIFYRE_RUNNER_INVARIANT_MODE || "check";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const orphans = await prisma.$queryRaw`
    SELECT
      s.id,
      s.name,
      s.current_runner_id AS "currentRunnerId",
      r.status AS "runnerStatus"
    FROM sources s
    LEFT JOIN runners r ON r.id = s.current_runner_id
    WHERE s.runner_status = 'RUNNING'
      AND (
        s.current_runner_id IS NULL
        OR r.id IS NULL
        OR r.status IN ('COMPLETED', 'ERROR')
      )
    ORDER BY s.updated_at DESC
  `;

  let repaired = 0;
  if (mode === "repair" && orphans.length > 0) {
    for (const orphan of orphans) {
      await prisma.source.update({
        where: { id: orphan.id },
        data: {
          runnerStatus: RunnerStatus.ERROR,
          currentRunnerId: null,
        },
      });
      repaired += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        mode,
        orphanedRunningSources: orphans.length,
        repaired,
        sources: orphans,
      },
      null,
      2,
    ),
  );

  if (mode !== "repair" && orphans.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
NODE

NODE_SCRIPT_B64="$(printf "%s" "${NODE_SCRIPT}" | base64 | tr -d '\n')"

kubectl -n "${NAMESPACE}" exec "deployment/${API_DEPLOYMENT}" -- env \
  CLASSIFYRE_RUNNER_INVARIANT_MODE="${MODE}" \
  NODE_SCRIPT_B64="${NODE_SCRIPT_B64}" \
  sh -lc '
    if [ -z "${DATABASE_URL:-}" ] && [ -n "${DB_HOST:-}" ]; then
      export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=${DB_SSLMODE:-disable}"
    fi
    node -e "$(printf "%s" "${NODE_SCRIPT_B64}" | base64 -d)"
  '
