/**
 * Deployment role of this process.
 *
 * - `api`: serves HTTP only — pg-boss queue workers, backfills, and platform
 *   pollers are not started (jobs can still be enqueued).
 * - `worker`: runs the background workers (the HTTP server still starts, so
 *   /ping probes work).
 * - `sql`: the SQL gateway for SQL connections (docs/prd/DQ-data-query.md
 *   §5.7): the PostgreSQL listener, no background workers (HTTP still starts
 *   for its probes).
 * - `all` (default): everything — used by the all-in-one image and local dev,
 *   where a single process is the whole deployment.
 */
export type ServiceRole = 'api' | 'worker' | 'sql' | 'all';

export function serviceRole(): ServiceRole {
  const raw = process.env.SERVICE_ROLE ?? 'all';
  if (raw === 'api' || raw === 'worker' || raw === 'sql' || raw === 'all') {
    return raw;
  }
  throw new Error(
    `SERVICE_ROLE must be api, worker, sql or all (got "${raw}")`,
  );
}

export function runsBackgroundWorkers(): boolean {
  const role = serviceRole();
  return role === 'worker' || role === 'all';
}

/** Whether this process listens for SQL connections (when the gateway is enabled). */
export function runsSqlGateway(): boolean {
  const role = serviceRole();
  return role === 'sql' || role === 'all';
}
