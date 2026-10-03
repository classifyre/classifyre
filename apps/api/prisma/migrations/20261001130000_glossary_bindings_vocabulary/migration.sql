-- SL2 · Bindings and the observed vocabulary
-- (docs/prd/SL2-bindings-and-vocabulary.md).
--
-- A binding says once what a detector output (or an asset metadata field)
-- means. It is never a pattern (rule SL-7): it selects from the vocabulary the
-- data already uses, optionally narrowed to observed values or read as codes.

CREATE TYPE "GlossaryBindingMode" AS ENUM ('OUTPUT', 'OUTPUT_VALUES', 'OUTPUT_LOOKUP', 'METADATA_VALUES', 'METADATA_LOOKUP');
CREATE TYPE "GlossaryLookupMatch" AS ENUM ('CODES', 'ANY');
CREATE TYPE "GlossaryBindingStatus" AS ENUM ('DRAFT', 'APPROVED', 'DISABLED');

CREATE TABLE "glossary_bindings" (
  "id"                  TEXT                    NOT NULL,
  "mode"                "GlossaryBindingMode"   NOT NULL,
  "detector_type"       "DetectorType",
  "custom_detector_key" TEXT,
  "finding_type"        TEXT,
  "metadata_path"       TEXT,
  "values"              TEXT[]                  NOT NULL DEFAULT ARRAY[]::TEXT[],
  "split_delimiter"     TEXT,
  "term_id"             TEXT,
  "lookup_scheme_id"    TEXT,
  "lookup_match"        "GlossaryLookupMatch",
  "no_meaning"          BOOLEAN                 NOT NULL DEFAULT false,
  "source_ids"          TEXT[]                  NOT NULL DEFAULT ARRAY[]::TEXT[],
  "confidence"          DECIMAL(3,2)            NOT NULL DEFAULT 1.00,
  "status"              "GlossaryBindingStatus" NOT NULL DEFAULT 'DRAFT',
  "origin"              "GlossaryOrigin"        NOT NULL,
  "rationale"           TEXT,
  "note"                TEXT,
  "pack_key"            TEXT,
  "created_by"          TEXT,
  "approved_by"         TEXT,
  "approved_at"         TIMESTAMP(3),
  "disabled_by"         TEXT,
  "disabled_at"         TIMESTAMP(3),
  "fingerprint"         TEXT                    NOT NULL,
  "created_at"          TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3)            NOT NULL,
  CONSTRAINT "glossary_bindings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "glossary_bindings_fingerprint_key" ON "glossary_bindings"("fingerprint");
CREATE INDEX "glossary_bindings_detector_type_finding_type_idx" ON "glossary_bindings"("detector_type", "finding_type");
CREATE INDEX "glossary_bindings_custom_detector_key_idx" ON "glossary_bindings"("custom_detector_key");
CREATE INDEX "glossary_bindings_term_id_idx" ON "glossary_bindings"("term_id");
CREATE INDEX "glossary_bindings_lookup_scheme_id_idx" ON "glossary_bindings"("lookup_scheme_id");
CREATE INDEX "glossary_bindings_status_idx" ON "glossary_bindings"("status");
ALTER TABLE "glossary_bindings"
  ADD CONSTRAINT "glossary_bindings_term_id_fkey"
  FOREIGN KEY ("term_id") REFERENCES "glossary_terms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "glossary_bindings"
  ADD CONSTRAINT "glossary_bindings_lookup_scheme_id_fkey"
  FOREIGN KEY ("lookup_scheme_id") REFERENCES "glossary_schemes"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "vocabulary_items" (
  "source_id"           TEXT           NOT NULL,
  "detector_type"       "DetectorType" NOT NULL,
  "custom_detector_key" TEXT           NOT NULL DEFAULT '',
  "finding_type"        TEXT           NOT NULL,
  "custom_detector_name" TEXT,
  "open_count"          INTEGER        NOT NULL,
  "asset_count"         INTEGER        NOT NULL,
  "distinct_values"     INTEGER,
  "top_values"          JSONB,
  "first_seen_at"       TIMESTAMP(3)   NOT NULL,
  "last_seen_at"        TIMESTAMP(3)   NOT NULL,
  "refreshed_at"        TIMESTAMP(3)   NOT NULL,
  CONSTRAINT "vocabulary_items_pkey" PRIMARY KEY ("source_id", "detector_type", "custom_detector_key", "finding_type")
);
CREATE INDEX "vocabulary_items_detector_type_custom_detector_key_finding__idx"
  ON "vocabulary_items"("detector_type", "custom_detector_key", "finding_type");

CREATE TABLE "vocabulary_fields" (
  "source_id"       TEXT         NOT NULL,
  "path"            TEXT         NOT NULL,
  "asset_count"     INTEGER      NOT NULL,
  "distinct_values" INTEGER,
  "top_values"      JSONB,
  "refreshed_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vocabulary_fields_pkey" PRIMARY KEY ("source_id", "path")
);

-- "Find in text" (D10): a generated REGEX detector remembers its term and the
-- labels it was generated from, so it can say when it is out of date.
ALTER TABLE "custom_detectors"
  ADD COLUMN "generated_from_term_id" TEXT,
  ADD COLUMN "generated_labels_hash"  TEXT;
CREATE INDEX "custom_detectors_generated_from_term_id_idx" ON "custom_detectors"("generated_from_term_id");

ALTER TABLE "glossary_activities" ADD COLUMN "binding_id" TEXT;
CREATE INDEX "glossary_activities_binding_id_idx" ON "glossary_activities"("binding_id");
