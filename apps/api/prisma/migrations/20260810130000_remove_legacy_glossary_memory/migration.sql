-- Canonicalize all shared vocabulary in glossary_terms, then remove the
-- legacy glossary/topic enum values from agent memory. This migration is
-- intentionally data-preserving for installations that used the old Harness
-- "Teach → Glossary" path after glossary_terms was introduced.

-- Carry any late legacy glossary memories into the canonical glossary. Never
-- replace operator-curated canonical fields; only fill a missing note/ref.
INSERT INTO "glossary_terms" (
  "id", "term", "notes", "ref_type", "ref_id", "origin",
  "verified_at", "verified_by", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  "key",
  "content",
  "ref_type",
  "ref_id",
  "origin",
  "verified_at",
  "verified_by",
  "created_at",
  "updated_at"
FROM "agent_memories"
WHERE "kind"::text = 'GLOSSARY'
ON CONFLICT ("term") DO UPDATE SET
  "notes" = COALESCE("glossary_terms"."notes", EXCLUDED."notes");

-- Replace the lossy single reference on a term with idempotent many-to-many
-- provenance. Existing references and late legacy-memory references survive.
CREATE TABLE "glossary_references" (
  "id" TEXT NOT NULL,
  "glossary_term_id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "glossary_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "glossary_references_glossary_term_id_fkey"
    FOREIGN KEY ("glossary_term_id") REFERENCES "glossary_terms"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "glossary_references_glossary_term_id_entity_type_entity_id_key"
  ON "glossary_references"("glossary_term_id", "entity_type", "entity_id");
CREATE INDEX "glossary_references_entity_type_entity_id_idx"
  ON "glossary_references"("entity_type", "entity_id");

INSERT INTO "glossary_references" (
  "id", "glossary_term_id", "entity_type", "entity_id", "created_by", "created_at"
)
SELECT
  gen_random_uuid()::text,
  gt."id",
  gt."ref_type",
  gt."ref_id",
  gt."verified_by",
  gt."created_at"
FROM "glossary_terms" gt
WHERE gt."ref_type" IS NOT NULL AND gt."ref_id" IS NOT NULL
ON CONFLICT ("glossary_term_id", "entity_type", "entity_id") DO NOTHING;

INSERT INTO "glossary_references" (
  "id", "glossary_term_id", "entity_type", "entity_id", "created_by", "created_at"
)
SELECT
  gen_random_uuid()::text,
  gt."id",
  am."ref_type",
  am."ref_id",
  am."verified_by",
  am."created_at"
FROM "agent_memories" am
JOIN "glossary_terms" gt ON gt."term" = am."key"
WHERE am."kind"::text = 'GLOSSARY'
  AND am."ref_type" IS NOT NULL
  AND am."ref_id" IS NOT NULL
ON CONFLICT ("glossary_term_id", "entity_type", "entity_id") DO NOTHING;

ALTER TABLE "glossary_terms"
  DROP COLUMN "ref_type",
  DROP COLUMN "ref_id";

-- TOPIC_INQUIRY_MAP was the pre-Harness name for ENTITY_MAP. Prefer an
-- existing modern row on key collisions, then rename every remaining row.
DELETE FROM "agent_memories" AS legacy
USING "agent_memories" AS modern
WHERE legacy."kind"::text = 'TOPIC_INQUIRY_MAP'
  AND modern."kind"::text = 'ENTITY_MAP'
  AND legacy."key" = modern."key";

UPDATE "agent_memories"
SET "kind" = 'ENTITY_MAP'::"AgentMemoryKind"
WHERE "kind"::text = 'TOPIC_INQUIRY_MAP';

DELETE FROM "agent_memories" WHERE "kind"::text = 'GLOSSARY';

-- Seed deterministic maps for existing investigation entities so upgraded
-- workspaces immediately expose their live cases/inquiries to Harness memory.
INSERT INTO "agent_memories" (
  "id", "kind", "key", "content", "tags", "ref_type", "ref_id",
  "weight", "origin", "verified_at", "verified_by", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  'ENTITY_MAP'::"AgentMemoryKind",
  'case:' || c."id",
  'Case "' || c."title" || '" [' || c."status"::text || ', ' ||
    c."severity"::text || ']. ' || COALESCE(c."description", ''),
  ARRAY['entity-map', 'case', lower(c."status"::text)]::text[],
  'case',
  c."id",
  1,
  'AGENT'::"AgentMemoryOrigin",
  now(),
  'system',
  c."created_at",
  c."updated_at"
FROM "cases" c
ON CONFLICT ("kind", "key") DO NOTHING;

INSERT INTO "agent_memories" (
  "id", "kind", "key", "content", "tags", "ref_type", "ref_id",
  "weight", "origin", "verified_at", "verified_by", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  'ENTITY_MAP'::"AgentMemoryKind",
  'inquiry:' || i."id",
  'Inquiry "' || i."title" || '" [' || i."status"::text || ']. ' ||
    COALESCE(i."description", '') || ' Matches: ' || i."match_count"::text || '.',
  ARRAY['entity-map', 'inquiry', lower(i."status"::text)]::text[],
  'inquiry',
  i."id",
  1,
  'AGENT'::"AgentMemoryOrigin",
  now(),
  'system',
  i."created_at",
  i."updated_at"
FROM "inquiries" i
ON CONFLICT ("kind", "key") DO NOTHING;

-- PostgreSQL enum values cannot be removed in place. Rebuild the type with
-- only supported modern memory kinds after all legacy rows are gone.
ALTER TABLE "agent_memories"
  ALTER COLUMN "kind" TYPE text USING "kind"::text;

DROP TYPE "AgentMemoryKind";

CREATE TYPE "AgentMemoryKind" AS ENUM (
  'DECISION_PRECEDENT',
  'ENTITY_MAP',
  'SOURCE_PROFILE',
  'DETECTOR_INSIGHT',
  'OPERATOR_DIRECTIVE'
);

ALTER TABLE "agent_memories"
  ALTER COLUMN "kind" TYPE "AgentMemoryKind"
  USING "kind"::"AgentMemoryKind";
