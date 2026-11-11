-- The audit trail names what changed (source/table name, group path,
-- workspace slug at record time), so Activity reads without extra lookups
-- and the per-table tab can filter on names, not just ids.
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "entity_name" TEXT;
CREATE INDEX IF NOT EXISTS "audit_events_entity_name_idx" ON "audit_events" ("entity_name");
