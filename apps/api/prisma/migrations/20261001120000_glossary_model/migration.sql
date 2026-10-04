-- SL1 · Glossary model: concepts and entities, keys, schemes, status,
-- taxonomy and relations (docs/prd/SL1-glossary-model.md).
--
-- Additive: every existing column keeps working. Existing rows are classified
-- (PERSON / ORGANIZATION / LOCATION become ENTITY, everything else CONCEPT),
-- given a stable key, and their verification becomes the approval stamp.

CREATE TYPE "GlossaryTermKind" AS ENUM ('CONCEPT', 'ENTITY');
CREATE TYPE "GlossaryStatus" AS ENUM ('DRAFT', 'APPROVED', 'DEPRECATED');
CREATE TYPE "GlossaryOrigin" AS ENUM ('OPERATOR', 'AGENT', 'PACK', 'IMPORT', 'SUGGESTION');
CREATE TYPE "GlossaryRelationType" AS ENUM ('BROADER', 'RELATED', 'PART_OF', 'INSTANCE_OF', 'CUSTOM');

-- The one value normaliser of the semantic layer (SL2 §4.4): NFKC, trimmed,
-- internal whitespace collapsed, case-folded. glossaryNorm() in
-- apps/api/src/glossary/glossary-norm.ts is the TypeScript half and must agree.
-- Created in the tenant schema (unqualified, so it lands on the search_path
-- the migration runs with).
CREATE OR REPLACE FUNCTION glossary_norm(value text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT lower(btrim(regexp_replace(normalize(value, NFKC), '\s+', ' ', 'g')))
$$;

CREATE TABLE "glossary_schemes" (
  "id"           TEXT              NOT NULL,
  "key"          TEXT              NOT NULL,
  "name"         TEXT              NOT NULL,
  "description"  TEXT,
  "color"        TEXT,
  "origin"       "GlossaryOrigin"  NOT NULL DEFAULT 'OPERATOR',
  "pack_key"     TEXT,
  "pack_version" TEXT,
  "created_by"   TEXT,
  "created_at"   TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3)      NOT NULL,
  CONSTRAINT "glossary_schemes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "glossary_schemes_key_key" ON "glossary_schemes"("key");

ALTER TABLE "glossary_terms"
  ADD COLUMN "kind"           "GlossaryTermKind" NOT NULL DEFAULT 'CONCEPT',
  ADD COLUMN "key"            TEXT,
  ADD COLUMN "previous_keys"  TEXT[]             NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "definition"     TEXT,
  ADD COLUMN "codes"          TEXT[]             NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "hidden_aliases" TEXT[]             NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "match_keys"     TEXT[]             NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "scheme_id"      TEXT,
  ADD COLUMN "status"         "GlossaryStatus"   NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "steward"        TEXT,
  ADD COLUMN "replaced_by_id" TEXT,
  ADD COLUMN "deprecated_at"  TIMESTAMP(3),
  ADD COLUMN "source_iri"     TEXT,
  ADD COLUMN "pack_key"       TEXT;

-- R8.2 kind, R8.3 status.
UPDATE "glossary_terms"
   SET "kind" = CASE WHEN "entity_type" IN ('PERSON', 'ORGANIZATION', 'LOCATION')
                     THEN 'ENTITY'::"GlossaryTermKind"
                     ELSE 'CONCEPT'::"GlossaryTermKind" END,
       "status" = CASE WHEN "verified_at" IS NOT NULL
                       THEN 'APPROVED'::"GlossaryStatus"
                       ELSE 'DRAFT'::"GlossaryStatus" END;

-- R8.3 key (R2): transliterate German letters, strip the common diacritics,
-- lowercase, runs of anything else become '-', trim to 100, then suffix
-- collisions -2, -3, ... in creation order.
WITH slugs AS (
  SELECT "id",
         COALESCE(NULLIF(btrim(left(regexp_replace(lower(translate(
           replace(replace(replace(replace(replace(replace(replace("term",
             'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'Ä', 'Ae'), 'Ö', 'Oe'), 'Ü', 'Ue'), 'ß', 'ss'),
           'àáâãåāăąçćčďđèéêëēėęěìíîïīįłñńňòóôõøōőřśšşťţùúûůűūųýÿźżžÀÁÂÃÅĀĂĄÇĆČĎĐÈÉÊËĒĖĘĚÌÍÎÏĪĮŁÑŃŇÒÓÔÕØŌŐŘŚŠŞŤŢÙÚÛŮŰŪŲÝŸŹŻŽ',
           'aaaaaaaacccddeeeeeeeeiiiiiilnnnooooooorsssttuuuuuuuyyzzzaaaaaaaacccddeeeeeeeeiiiiiilnnnooooooorsssttuuuuuuuyyzzz')),
           '[^a-z0-9]+', '-', 'g'), 94), '-'), ''), 'term') AS base,
         "created_at"
    FROM "glossary_terms"
), ranked AS (
  SELECT "id", base,
         row_number() OVER (PARTITION BY base ORDER BY "created_at", "id") AS n
    FROM slugs
)
UPDATE "glossary_terms" gt
   SET "key" = CASE WHEN ranked.n = 1 THEN ranked.base ELSE ranked.base || '-' || ranked.n END
  FROM ranked
 WHERE ranked."id" = gt."id";

-- A base that ends in '-<n>' can still collide with a suffixed sibling; settle
-- any such leftovers with the id fragment, which is unique.
UPDATE "glossary_terms" gt
   SET "key" = left(gt."key", 90) || '-' || left(gt."id", 8)
 WHERE EXISTS (
   SELECT 1 FROM "glossary_terms" other
    WHERE other."key" = gt."key" AND other."id" < gt."id"
 );

-- A key must start with a letter or digit (C8).
UPDATE "glossary_terms" SET "key" = 't' || "key" WHERE "key" !~ '^[a-z0-9]';

ALTER TABLE "glossary_terms" ALTER COLUMN "key" SET NOT NULL;
CREATE UNIQUE INDEX "glossary_terms_key_key" ON "glossary_terms"("key");

-- R7 match keys: the normalised term, aliases, codes and hidden aliases.
UPDATE "glossary_terms"
   SET "match_keys" = ARRAY(
     SELECT DISTINCT glossary_norm(v)
       FROM unnest(ARRAY["term"] || "aliases" || "codes" || "hidden_aliases") AS v
      WHERE glossary_norm(v) <> ''
   );

-- R8.4: names are unique per scheme for concepts only. Entities may share a
-- name (two people called Jane Doe are two entities). Prisma cannot model a
-- partial index; it is documented on the model in schema.prisma.
-- The old unique index was case-sensitive; the service matched names
-- case-insensitively, but rows written around it could differ only by case.
-- Keep the oldest name and suffix the others so the new index can be built.
WITH dupes AS (
  SELECT "id",
         row_number() OVER (PARTITION BY lower("term") ORDER BY "created_at", "id") AS n
    FROM "glossary_terms"
   WHERE "kind" = 'CONCEPT'
)
UPDATE "glossary_terms" gt
   SET "term" = gt."term" || ' (' || dupes.n || ')'
  FROM dupes
 WHERE dupes."id" = gt."id" AND dupes.n > 1;

DROP INDEX IF EXISTS "glossary_terms_term_key";
CREATE UNIQUE INDEX "glossary_terms_concept_scheme_term_key"
  ON "glossary_terms" (COALESCE("scheme_id", ''), lower("term"))
  WHERE "kind" = 'CONCEPT';

CREATE INDEX "glossary_terms_kind_status_idx" ON "glossary_terms"("kind", "status");
CREATE INDEX "glossary_terms_scheme_id_idx" ON "glossary_terms"("scheme_id");
CREATE INDEX "glossary_terms_match_keys_idx" ON "glossary_terms" USING GIN ("match_keys");
CREATE INDEX "glossary_terms_codes_idx" ON "glossary_terms" USING GIN ("codes");
CREATE INDEX "glossary_terms_previous_keys_idx" ON "glossary_terms" USING GIN ("previous_keys");
CREATE INDEX "glossary_terms_source_iri_idx" ON "glossary_terms"("source_iri");

ALTER TABLE "glossary_terms"
  ADD CONSTRAINT "glossary_terms_scheme_id_fkey"
  FOREIGN KEY ("scheme_id") REFERENCES "glossary_schemes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "glossary_terms"
  ADD CONSTRAINT "glossary_terms_replaced_by_id_fkey"
  FOREIGN KEY ("replaced_by_id") REFERENCES "glossary_terms"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "glossary_relations" (
  "id"           TEXT                   NOT NULL,
  "from_term_id" TEXT                   NOT NULL,
  "to_term_id"   TEXT                   NOT NULL,
  "type"         "GlossaryRelationType" NOT NULL,
  "label"        TEXT                   NOT NULL DEFAULT '',
  "status"       "GlossaryStatus"       NOT NULL DEFAULT 'DRAFT',
  "origin"       "GlossaryOrigin"       NOT NULL DEFAULT 'OPERATOR',
  "note"         TEXT,
  "approved_by"  TEXT,
  "approved_at"  TIMESTAMP(3),
  "created_by"   TEXT,
  "created_at"   TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3)           NOT NULL,
  CONSTRAINT "glossary_relations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "glossary_relations_from_term_id_to_term_id_type_label_key"
  ON "glossary_relations"("from_term_id", "to_term_id", "type", "label");
CREATE INDEX "glossary_relations_to_term_id_type_idx" ON "glossary_relations"("to_term_id", "type");
CREATE INDEX "glossary_relations_status_idx" ON "glossary_relations"("status");
ALTER TABLE "glossary_relations"
  ADD CONSTRAINT "glossary_relations_from_term_id_fkey"
  FOREIGN KEY ("from_term_id") REFERENCES "glossary_terms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "glossary_relations"
  ADD CONSTRAINT "glossary_relations_to_term_id_fkey"
  FOREIGN KEY ("to_term_id") REFERENCES "glossary_terms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "glossary_activities" (
  "id"          TEXT         NOT NULL,
  "term_id"     TEXT,
  "scheme_id"   TEXT,
  "relation_id" TEXT,
  "type"        TEXT         NOT NULL,
  "actor"       TEXT,
  "payload"     JSONB,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "glossary_activities_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "glossary_activities_term_id_created_at_idx" ON "glossary_activities"("term_id", "created_at" DESC);
CREATE INDEX "glossary_activities_created_at_idx" ON "glossary_activities"("created_at");

-- Agent guardrails for approvals (SL0 §8, D7) and the one-time migration
-- banner (R8).
ALTER TABLE "instance_settings"
  ADD COLUMN "autopilot_glossary_approve_enabled"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "autopilot_glossary_approvals_per_day" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "autopilot_binding_impact_limit"       INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN "glossary_kind_banner_dismissed_at"    TIMESTAMP(3);

ALTER TYPE "AgentDecisionAction" ADD VALUE IF NOT EXISTS 'APPROVE_RELATION';
ALTER TYPE "AgentDecisionAction" ADD VALUE IF NOT EXISTS 'APPROVE_BINDING';
