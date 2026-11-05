-- Audit trail: one row per successful change in this workspace (REST route or
-- MCP tool), with who made it and which fields were sent, never their values.
CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor" TEXT,
  "via" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" INTEGER,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "audit_events_entity_type_entity_id_occurred_at_idx"
  ON "audit_events" ("entity_type", "entity_id", "occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_events_occurred_at_idx"
  ON "audit_events" ("occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_events_actor_occurred_at_idx"
  ON "audit_events" ("actor", "occurred_at" DESC);

-- Actor references: the autopilot is `agent:autopilot` now, in line with
-- `mcp:<token>` and `system:<job>`. Self-declared names stay plain text.
UPDATE "notebook_executions" SET "triggered_by" = 'agent:autopilot' WHERE "triggered_by" = 'ai-autopilot';
UPDATE "runners" SET "triggered_by" = 'agent:autopilot' WHERE "triggered_by" = 'ai-autopilot';
UPDATE "notifications" SET "triggered_by" = 'agent:autopilot' WHERE "triggered_by" = 'ai-autopilot';
UPDATE "correlation_pair_verdicts" SET "decided_by" = 'agent:autopilot' WHERE "decided_by" = 'ai-autopilot';
UPDATE "correlation_review_batches" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "cases" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "case_leads" SET "proposed_by" = 'agent:autopilot' WHERE "proposed_by" = 'ai-autopilot';
UPDATE "case_leads" SET "reviewed_by" = 'agent:autopilot' WHERE "reviewed_by" = 'ai-autopilot';
UPDATE "case_events" SET "verified_by" = 'agent:autopilot' WHERE "verified_by" = 'ai-autopilot';
UPDATE "case_events" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "inquiries" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "inquiry_activities" SET "actor" = 'agent:autopilot' WHERE "actor" = 'ai-autopilot';
UPDATE "case_finding_filters" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "case_hypothesis_rules" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "case_evidence" SET "added_by" = 'agent:autopilot' WHERE "added_by" = 'ai-autopilot';
UPDATE "case_notes" SET "author" = 'agent:autopilot' WHERE "author" = 'ai-autopilot';
UPDATE "case_threads" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "case_threads" SET "resolved_by" = 'agent:autopilot' WHERE "resolved_by" = 'ai-autopilot';
UPDATE "case_thread_entries" SET "author" = 'agent:autopilot' WHERE "author" = 'ai-autopilot';
UPDATE "case_activities" SET "actor" = 'agent:autopilot' WHERE "actor" = 'ai-autopilot';
UPDATE "case_board_items" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "case_board_items" SET "updated_by" = 'agent:autopilot' WHERE "updated_by" = 'ai-autopilot';
UPDATE "case_board_links" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "case_board_links" SET "updated_by" = 'agent:autopilot' WHERE "updated_by" = 'ai-autopilot';
UPDATE "case_board_snapshots" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "agent_system_brief" SET "updated_by" = 'agent:autopilot' WHERE "updated_by" = 'ai-autopilot';
UPDATE "agent_memories" SET "verified_by" = 'agent:autopilot' WHERE "verified_by" = 'ai-autopilot';
UPDATE "agent_undo_entries" SET "reverted_by" = 'agent:autopilot' WHERE "reverted_by" = 'ai-autopilot';
UPDATE "glossary_terms" SET "approved_by" = 'agent:autopilot' WHERE "approved_by" = 'ai-autopilot';
UPDATE "entity_values" SET "decided_by" = 'agent:autopilot' WHERE "decided_by" = 'ai-autopilot';
UPDATE "entity_values" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "glossary_schemes" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "glossary_relations" SET "approved_by" = 'agent:autopilot' WHERE "approved_by" = 'ai-autopilot';
UPDATE "glossary_relations" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "glossary_activities" SET "actor" = 'agent:autopilot' WHERE "actor" = 'ai-autopilot';
UPDATE "glossary_references" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "glossary_bindings" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "glossary_bindings" SET "approved_by" = 'agent:autopilot' WHERE "approved_by" = 'ai-autopilot';
UPDATE "glossary_bindings" SET "disabled_by" = 'agent:autopilot' WHERE "disabled_by" = 'ai-autopilot';
UPDATE "semantic_suggestions" SET "decided_by" = 'agent:autopilot' WHERE "decided_by" = 'ai-autopilot';
UPDATE "semantic_suggestions" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "data_transfer_jobs" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "finding_bulk_operations" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
UPDATE "explore_views" SET "created_by" = 'agent:autopilot' WHERE "created_by" = 'ai-autopilot';
