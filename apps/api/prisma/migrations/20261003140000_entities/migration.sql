-- G5 · Entities: from mentions to things (docs/prd/G5-entities.md).
--
-- An entity is an ENTITY-kind glossary term. Its confirmed values live in
-- `entity_values`, and its mentions are the join of those values with the
-- value index (`asset_correlation_values`) on `value_hash`; nothing is stored
-- per finding. Additive: existing terms keep working unchanged.

CREATE TYPE "EntityValueMethod" AS ENUM ('EXACT_ALIAS', 'IDENTIFIER', 'CONNECTOR', 'PHONETIC', 'FUZZY', 'MANUAL');
CREATE TYPE "EntityValueVerdict" AS ENUM ('CONFIRMED', 'PROPOSED', 'REJECTED');

-- A source may declare an entity (R13). New enum values cannot be used in the
-- statement block that adds them, and nothing below does.
ALTER TYPE "GlossaryOrigin" ADD VALUE IF NOT EXISTS 'CONNECTOR';
ALTER TYPE "CaseLeadOrigin" ADD VALUE IF NOT EXISTS 'ENTITY';

-- A term's origin was the two-value agent-memory enum. It moves to the
-- glossary's own, which every other glossary table already uses.
ALTER TABLE "glossary_terms" ALTER COLUMN "origin" DROP DEFAULT;
ALTER TABLE "glossary_terms"
  ALTER COLUMN "origin" TYPE "GlossaryOrigin" USING "origin"::text::"GlossaryOrigin";
ALTER TABLE "glossary_terms" ALTER COLUMN "origin" SET DEFAULT 'OPERATOR';

ALTER TABLE "glossary_terms"
  ADD COLUMN "anchor_urn"    TEXT,
  ADD COLUMN "attributes"    JSONB,
  ADD COLUMN "mention_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "asset_count"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "source_count"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "first_seen_at" TIMESTAMP(3),
  ADD COLUMN "last_seen_at"  TIMESTAMP(3),
  ADD COLUMN "merged_at"     TIMESTAMP(3);
CREATE INDEX "glossary_terms_anchor_urn_idx" ON "glossary_terms"("anchor_urn");

CREATE TABLE "entity_values" (
  "id"               TEXT                 NOT NULL,
  "term_id"          TEXT                 NOT NULL,
  "value_hash"       VARCHAR(64)          NOT NULL,
  "label"            TEXT                 NOT NULL,
  "normalized_value" TEXT                 NOT NULL,
  "raw_value"        TEXT,
  "phonetic_hash"    VARCHAR(64),
  "fold_key"         TEXT,
  "method"           "EntityValueMethod"  NOT NULL,
  "verdict"          "EntityValueVerdict" NOT NULL,
  "score"            DOUBLE PRECISION,
  "conflict_term_id" TEXT,
  "agent_verdict"    TEXT,
  "agent_note"       TEXT,
  "decided_by"       TEXT,
  "decided_at"       TIMESTAMP(3),
  "created_by"       TEXT,
  "created_at"       TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entity_values_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "entity_values_term_id_fkey" FOREIGN KEY ("term_id")
    REFERENCES "glossary_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "entity_values_term_id_value_hash_key" ON "entity_values"("term_id", "value_hash");
CREATE INDEX "entity_values_value_hash_verdict_idx" ON "entity_values"("value_hash", "verdict");
CREATE INDEX "entity_values_label_phonetic_hash_idx" ON "entity_values"("label", "phonetic_hash");
CREATE INDEX "entity_values_fold_key_idx" ON "entity_values"("fold_key");
CREATE INDEX "entity_values_verdict_score_idx" ON "entity_values"("verdict", "score" DESC);

CREATE TABLE "entity_config" (
  "id"                 INTEGER      NOT NULL DEFAULT 1,
  "enabled"            BOOLEAN      NOT NULL DEFAULT true,
  "disabled_mode"      TEXT,
  "enabled_changed_at" TIMESTAMP(3),
  "name_labels"        JSONB        NOT NULL DEFAULT '{}',
  "identifier_labels"  TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "recounted_at"       TIMESTAMP(3),
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entity_config_pkey" PRIMARY KEY ("id")
);

-- Off for workspaces that already hold data, on (no row) for new ones (§8).
-- Turning it on backfills values for the existing entities and builds counters.
INSERT INTO "entity_config" ("id", "enabled", "disabled_mode")
SELECT 1, false, 'kept'
 WHERE EXISTS (SELECT 1 FROM "sources");
