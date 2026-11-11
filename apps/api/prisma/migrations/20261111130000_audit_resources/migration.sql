-- What an audit event touched beyond its one entity (`data`, `source:<id>`,
-- `asset:<id>`), so a source's or a table's Activity tab filters exactly:
-- reads of its tables and access given on it, nothing that only mentions it.
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "resources" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX IF NOT EXISTS "audit_events_resources_idx" ON "audit_events" USING GIN ("resources");
