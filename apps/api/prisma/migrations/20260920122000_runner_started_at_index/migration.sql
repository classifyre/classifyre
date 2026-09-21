-- Fair queuing asks each namespace "when were you last given a slot", which is
-- MAX(started_at) over its runners, on every dequeue. Without an index that is
-- a sequential scan of the whole run history per namespace.
CREATE INDEX IF NOT EXISTS "runners_started_at_idx" ON "runners"("started_at");
