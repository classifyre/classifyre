-- SL3 · Semantic links: the semantic lineage (docs/prd/SL3-semantic-links.md).
--
-- asset_terms is a rollup, one row per asset × term × method (rule SL-2: never
-- a row per finding). Only the semantic linker writes it.

CREATE TYPE "SemanticLinkMethod" AS ENUM ('BINDING', 'DECLARED', 'MANUAL', 'SUGGESTED', 'MENTION');
CREATE TYPE "GlossaryReferenceRole" AS ENUM ('PROVENANCE', 'ABOUT');

CREATE TABLE "asset_terms" (
  "asset_id"          TEXT                 NOT NULL,
  "term_id"           TEXT                 NOT NULL,
  "method"            "SemanticLinkMethod" NOT NULL,
  "source_id"         TEXT                 NOT NULL,
  "support_count"     INTEGER              NOT NULL,
  "binding_ids"       TEXT[]               NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sample_finding_id" TEXT,
  "max_severity"      "Severity",
  "confidence"        DECIMAL(3,2)         NOT NULL DEFAULT 1.00,
  "first_linked_at"   TIMESTAMP(3)         NOT NULL,
  "last_linked_at"    TIMESTAMP(3)         NOT NULL,
  "gone_at"           TIMESTAMP(3),
  CONSTRAINT "asset_terms_pkey" PRIMARY KEY ("asset_id", "term_id", "method")
);
CREATE INDEX "asset_terms_term_id_gone_at_idx" ON "asset_terms"("term_id", "gone_at");
CREATE INDEX "asset_terms_source_id_term_id_idx" ON "asset_terms"("source_id", "term_id");
ALTER TABLE "asset_terms"
  ADD CONSTRAINT "asset_terms_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_terms"
  ADD CONSTRAINT "asset_terms_term_id_fkey"
  FOREIGN KEY ("term_id") REFERENCES "glossary_terms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- R5 manual links: a reference is either provenance ("this case established
-- the term", today's meaning) or a semantic link ("this finding is about it").
-- The column lands with its default before the unique key is swapped, so
-- existing rows become PROVENANCE.
ALTER TABLE "glossary_references"
  ADD COLUMN "role" "GlossaryReferenceRole" NOT NULL DEFAULT 'PROVENANCE',
  ADD COLUMN "note" TEXT;
CREATE UNIQUE INDEX "glossary_references_glossary_term_id_entity_type_entity_id__key"
  ON "glossary_references"("glossary_term_id", "entity_type", "entity_id", "role");
DROP INDEX IF EXISTS "glossary_references_glossary_term_id_entity_type_entity_id_key";
CREATE INDEX "glossary_references_role_entity_type_idx" ON "glossary_references"("role", "entity_type");

CREATE TABLE "semantic_stats" (
  "day"                   DATE         NOT NULL,
  "open_findings"         INTEGER      NOT NULL,
  "findings_with_meaning" INTEGER      NOT NULL,
  "assets_with_meaning"   INTEGER      NOT NULL,
  "computed_at"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "semantic_stats_pkey" PRIMARY KEY ("day")
);

CREATE TABLE "semantic_link_jobs" (
  "id"          TEXT             NOT NULL,
  "kind"        TEXT             NOT NULL,
  "trigger"     JSONB            NOT NULL,
  "status"      TEXT             NOT NULL,
  "cursor"      JSONB,
  "progress"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "added"       INTEGER          NOT NULL DEFAULT 0,
  "gone"        INTEGER          NOT NULL DEFAULT 0,
  "error"       TEXT,
  "started_at"  TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "semantic_link_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "semantic_link_jobs_status_created_at_idx" ON "semantic_link_jobs"("status", "created_at");

-- Inquiry matcher dimension (R7.6): findings that are evidence of a term.
ALTER TABLE "inquiries"
  ADD COLUMN "term_keys"             TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "terms_include_narrower" BOOLEAN NOT NULL DEFAULT false;
