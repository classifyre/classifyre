/**
 * Deployment role of this process.
 *
 * - `api`: serves HTTP only — pg-boss queue workers, backfills, and platform
 *   pollers are not started (jobs can still be enqueued).
 * - `worker`: runs the background workers (the HTTP server still starts, so
 *   /ping probes work).
 * - `all` (default): both — used by desktop and local dev, where a single
 *   process is the whole deployment.
 */
export type ServiceRole = 'api' | 'worker' | 'all';

export function serviceRole(): ServiceRole {
  const raw = process.env.SERVICE_ROLE ?? 'all';
  if (raw === 'api' || raw === 'worker' || raw === 'all') return raw;
  throw new Error(`SERVICE_ROLE must be api, worker, or all (got "${raw}")`);
}

export function runsBackgroundWorkers(): boolean {
  return serviceRole() !== 'api';
}
