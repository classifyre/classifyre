-- Agent memory provenance: agent-authored memory is untrusted until verified.
CREATE TYPE "AgentMemoryOrigin" AS ENUM ('AGENT', 'OPERATOR');

ALTER TABLE "agent_memories"
  ADD COLUMN "origin" "AgentMemoryOrigin" NOT NULL DEFAULT 'AGENT',
  ADD COLUMN "verified_at" TIMESTAMP(3),
  ADD COLUMN "verified_by" TEXT;

-- Operator-deletion precedents and directives were operator-driven facts.
UPDATE "agent_memories"
SET "origin" = 'OPERATOR', "verified_at" = "updated_at", "verified_by" = 'operator'
WHERE "kind" = 'OPERATOR_DIRECTIVE' OR 'operator-deletion' = ANY("tags");

-- Investigation glossary: shared operator/agent vocabulary.
CREATE TYPE "GlossaryEntityType" AS ENUM ('PERSON', 'ORGANIZATION', 'LOCATION', 'REFERENCE', 'TERM', 'OTHER');

CREATE TABLE "glossary_terms" (
  "id" TEXT NOT NULL,
  "term" TEXT NOT NULL,
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "entity_type" "GlossaryEntityType" NOT NULL DEFAULT 'TERM',
  "notes" TEXT,
  "ref_type" TEXT,
  "ref_id" TEXT,
  "origin" "AgentMemoryOrigin" NOT NULL DEFAULT 'OPERATOR',
  "verified_at" TIMESTAMP(3),
  "verified_by" TEXT,
  "embed_content_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "glossary_terms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "glossary_terms_term_key" ON "glossary_terms"("term");
CREATE INDEX "glossary_terms_entity_type_idx" ON "glossary_terms"("entity_type");

-- Seed from the legacy agent-memory glossary so existing vocabulary carries
-- over. Agent-written entries stay agent-origin and unverified.
INSERT INTO "glossary_terms" ("id", "term", "notes", "ref_type", "ref_id", "origin", "created_at", "updated_at")
SELECT gen_random_uuid()::text, "key", "content", "ref_type", "ref_id", "origin", "created_at", "updated_at"
FROM "agent_memories"
WHERE "kind" = 'GLOSSARY'
ON CONFLICT ("term") DO NOTHING;
