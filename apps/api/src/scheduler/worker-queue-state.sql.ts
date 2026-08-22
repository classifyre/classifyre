/**
 * Raw-SQL primitives for worker queue observability.
 *
 * Like the namespace registry, these tables live in the `public` schema and
 * are hand-managed rather than modelled in Prisma. Two reasons:
 *
 * 1. The data is cross-namespace. A `SERVICE_ROLE=api` pod rendering the
 *    worker view is almost never the pod that ran the job, and a worker pod
 *    holds queues for every resident namespace at once.
 * 2. Per-tenant Prisma models would create one copy of these tables inside
 *    every `ns_<uuid>` schema, which is exactly the wrong shape.
 *
 * The DDL is idempotent and runs on every boot next to `REGISTRY_TABLE_DDL`.
 */

/**
 * Observed state of one queue, as reported by one worker process.
 *
 * Keyed by `(instance_id, namespace_id, queue)` because several worker
 * replicas can serve the same namespace queue simultaneously — each reports
 * its own row and the reader aggregates.
 *
 * `heartbeat_at` is what makes the view trustworthy: a pod that is OOM-killed
 * mid-job never gets to write a terminal status, so its row would otherwise
 * read `running` forever — precisely the false reassurance this view exists to
 * remove. Readers treat a row whose heartbeat has gone quiet as stale.
 */
export const WORKER_QUEUE_STATE_DDL = `
CREATE TABLE IF NOT EXISTS public.worker_queue_state (
  instance_id      text NOT NULL,
  namespace_id     uuid NOT NULL,
  queue            text NOT NULL,
  status           text NOT NULL DEFAULT 'idle',
  active_jobs      integer NOT NULL DEFAULT 0,
  job_ids          text[] NOT NULL DEFAULT '{}',
  started_at       timestamptz,
  last_finished_at timestamptz,
  last_duration_ms integer,
  run_count        bigint NOT NULL DEFAULT 0,
  failure_count    bigint NOT NULL DEFAULT 0,
  last_error       text,
  last_error_at    timestamptz,
  heartbeat_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, namespace_id, queue)
);
CREATE INDEX IF NOT EXISTS worker_queue_state_namespace_idx
  ON public.worker_queue_state (namespace_id);

CREATE TABLE IF NOT EXISTS public.worker_queue_pauses (
  namespace_id uuid NOT NULL,
  queue        text NOT NULL,
  paused_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace_id, queue)
);
`;

/**
 * How long a worker row stays believable after its last heartbeat.
 *
 * Six flush intervals. Long enough that a busy event loop or a brief network
 * blip does not flap the whole view to "stale", short enough that a killed pod
 * stops claiming to be running within half a minute.
 */
export const WORKER_HEARTBEAT_STALE_MS = 30_000;

/** How often a worker process flushes its in-memory counters to Postgres. */
export const WORKER_STATE_FLUSH_MS = 5_000;
