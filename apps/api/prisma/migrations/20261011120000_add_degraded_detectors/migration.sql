-- Remember which detectors ended a run degraded, so the skipped assets are retried later.
--
-- A run that ends with a detector the circuit breaker disabled mid-run keeps
-- advancing the AUTOMATIC sweep: dropping the cursor every degraded run would
-- pin the sweep to its first window for as long as the detector stays refused
-- (revoked key, exhausted quota), and every other detector on the source
-- would never reach the rest of it either. So the cursor is persisted as
-- usual, and the degraded detector keys (scan-cache identity keys) are
-- remembered here instead. The first later run that completes with none of
-- the remembered detectors degraded drops the cursor once, and the run after
-- that restarts the sweep while the scan cache -- which never banks an
-- errored detector -- retries exactly the skipped work.
--
-- Nullable: null (and any non-array value, which readers treat as empty)
-- means the latest finalized run ended with no detector degraded.
--
-- prisma migrate runs each migration inside a transaction, so no transaction
-- control here. The statement is idempotent so a partial apply can be re-run.

ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "degraded_detectors" JSONB;
