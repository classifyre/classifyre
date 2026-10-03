-- SL4 · Suggestions and the review queue
-- (docs/prd/SL4-suggestions-and-review.md).

CREATE TYPE "SemanticSuggestionKind" AS ENUM ('BINDING', 'RELATION', 'LINK');
CREATE TYPE "SemanticSuggestionStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DISMISSED', 'EXPIRED');

CREATE TABLE "semantic_suggestions" (
  "id"             TEXT                       NOT NULL,
  "kind"           "SemanticSuggestionKind"   NOT NULL,
  "status"         "SemanticSuggestionStatus" NOT NULL DEFAULT 'PROPOSED',
  "term_id"        TEXT,
  "asset_id"       TEXT,
  "payload"        JSONB                      NOT NULL,
  "score"          DECIMAL(4,3)               NOT NULL,
  "generator"      TEXT                       NOT NULL,
  "origin"         "GlossaryOrigin"           NOT NULL DEFAULT 'SUGGESTION',
  "rationale"      TEXT                       NOT NULL,
  "evidence"       JSONB,
  "fingerprint"    TEXT                       NOT NULL,
  "support_count"  INTEGER                    NOT NULL DEFAULT 0,
  "suppressed"     BOOLEAN                    NOT NULL DEFAULT false,
  "previous_id"    TEXT,
  "decided_by"     TEXT,
  "decided_at"     TIMESTAMP(3),
  "dismiss_reason" TEXT,
  "agent_note"     TEXT,
  "created_by"     TEXT,
  "created_at"     TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3)               NOT NULL,
  CONSTRAINT "semantic_suggestions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "semantic_suggestions_status_kind_score_idx" ON "semantic_suggestions"("status", "kind", "score" DESC);
CREATE INDEX "semantic_suggestions_term_id_status_idx" ON "semantic_suggestions"("term_id", "status");
CREATE INDEX "semantic_suggestions_kind_fingerprint_idx" ON "semantic_suggestions"("kind", "fingerprint");
-- One live row per fingerprint; dismissed history keeps its own rows.
CREATE UNIQUE INDEX "semantic_suggestions_live_fingerprint_key"
  ON "semantic_suggestions"("kind", "fingerprint") WHERE "status" = 'PROPOSED';
ALTER TABLE "semantic_suggestions"
  ADD CONSTRAINT "semantic_suggestions_term_id_fkey"
  FOREIGN KEY ("term_id") REFERENCES "glossary_terms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "semantic_suggestions"
  ADD CONSTRAINT "semantic_suggestions_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "instance_settings"
  ADD COLUMN "suggestion_generators"               JSONB,
  ADD COLUMN "suggestion_min_score"                JSONB,
  ADD COLUMN "suggestion_link_cap_per_concept"     INTEGER          NOT NULL DEFAULT 200,
  ADD COLUMN "suggestion_cooccurrence_min_support" INTEGER          NOT NULL DEFAULT 20,
  ADD COLUMN "suggestion_cooccurrence_min_lift"    DOUBLE PRECISION NOT NULL DEFAULT 3,
  ADD COLUMN "glossary_proposals_notified"         JSONB;
