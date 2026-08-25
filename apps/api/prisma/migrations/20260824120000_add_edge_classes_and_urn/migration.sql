-- Give every edge a class, so lineage can have its own traversal.
--
-- Until now `edges.relation_type` carried CONTAINS, REFERENCES, READS and
-- GENERATED_FROM side by side in one free-form string column with one
-- traversal, so an impact query and a governance cascade walked the same graph.
-- `relation_class` is the small fixed axis that separates them; `relation_type`
-- stays free-form, because that flexibility is what lets a connector introduce
-- a subtype without a migration.
--
-- Also adds the column-level and provenance fields, and `assets.urn` — the
-- platform-qualified name that lets one connector point at an object another
-- connector owns.

-- CreateEnum
CREATE TYPE "EdgeClass" AS ENUM ('FLOW', 'CONTAINMENT', 'IDENTITY', 'REFERENCE', 'USAGE');
CREATE TYPE "EdgeGranularity" AS ENUM ('DATASET', 'FIELD');
CREATE TYPE "EdgeMethod" AS ENUM ('RUNTIME_OBSERVED', 'SYSTEM_CATALOG', 'SQL_PARSED', 'HEURISTIC', 'MANUAL');

-- AlterTable
-- REFERENCE is the default because it is the class that propagates nothing: an
-- edge whose meaning nobody declared must not silently become a lineage hop.
ALTER TABLE "edges" ADD COLUMN "relation_class" "EdgeClass" NOT NULL DEFAULT 'REFERENCE';
ALTER TABLE "edges" ADD COLUMN "granularity" "EdgeGranularity" NOT NULL DEFAULT 'DATASET';
ALTER TABLE "edges" ADD COLUMN "method" "EdgeMethod" NOT NULL DEFAULT 'SYSTEM_CATALOG';
ALTER TABLE "edges" ADD COLUMN "field_mappings" JSONB;
ALTER TABLE "edges" ADD COLUMN "evidence" JSONB;
ALTER TABLE "edges" ADD COLUMN "via_type" TEXT;
ALTER TABLE "edges" ADD COLUMN "via_id" TEXT;
ALTER TABLE "edges" ADD COLUMN "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
-- Not unique: two source configs may legitimately scan the same warehouse, and
-- a unique constraint would make the second scan fail.
ALTER TABLE "assets" ADD COLUMN "urn" TEXT;

-- Backfill the class of every existing edge from its relation type.
--
-- Structural relations. Containment is what the lineage view collapses *by*;
-- it must never add a hop to a path.
UPDATE "edges" SET "relation_class" = 'CONTAINMENT'
WHERE "relation_type" IN ('CONTAINS', 'ATTACHED_TO');

-- Data movement that already points the way the data flows.
UPDATE "edges" SET "relation_class" = 'FLOW'
WHERE "relation_type" IN ('WRITES', 'EXPORTED_TO', 'SENT_TO');

-- Who touched it. READS belongs here rather than in FLOW: this product already
-- uses it as an access relation ("who touched this?" answers with incoming
-- ACCESSED/READS/EXECUTED), and it points from the reader to the thing read,
-- which is the opposite of the way the data moved.
UPDATE "edges" SET "relation_class" = 'USAGE'
WHERE "relation_type" IN ('OWNS', 'ACCESSED', 'READS', 'EXECUTED');

-- The same bytes in two places is the same thing seen twice, which is what the
-- lineage view's "merge identical nodes" control acts on.
UPDATE "edges" SET "relation_class" = 'IDENTITY'
WHERE "relation_type" = 'identical_content';

-- Everything else keeps the REFERENCE default: REFERENCES, MENTIONS, the
-- correlation types (related, likely_duplicate) and links_to. They are about
-- meaning or navigation, and propagate nothing.

-- GENERATED_FROM is the one legacy type pointing the wrong way. It reads
-- "X was generated from Y", i.e. downstream -> upstream, while a FLOW edge
-- points upstream -> downstream so the arrow follows the data. Flip it.
--
-- Only manual, hand-drawn edges can be of this type (no connector and no
-- inference pass has ever produced one), so this touches few rows if any.

-- First drop the half of any mutual pair that the flip would collide with,
-- keeping the lower id. A mutual GENERATED_FROM is a cycle and means nothing.
DELETE FROM "edges" e
USING "edges" o
WHERE e."relation_type" = 'GENERATED_FROM'
  AND o."relation_type" = 'GENERATED_FROM'
  AND o."from_type" = e."to_type" AND o."from_id" = e."to_id"
  AND o."to_type" = e."from_type" AND o."to_id" = e."from_id"
  AND e."id" > o."id";

-- Then swap the endpoints and rename to the direction-neutral subtype. The
-- right-hand side of a SET list reads the old row, so this swaps atomically.
UPDATE "edges"
SET "from_type" = "to_type",
    "from_id"   = "to_id",
    "to_type"   = "from_type",
    "to_id"     = "from_id",
    "relation_type"  = 'TRANSFORM',
    "relation_class" = 'FLOW'
WHERE "relation_type" = 'GENERATED_FROM';

-- CreateIndex
-- The lineage traversal always filters by class first, then walks an endpoint.
CREATE INDEX "edges_relation_class_from_type_from_id_idx" ON "edges"("relation_class", "from_type", "from_id");
CREATE INDEX "edges_relation_class_to_type_to_id_idx" ON "edges"("relation_class", "to_type", "to_id");
CREATE INDEX "assets_urn_idx" ON "assets"("urn");
