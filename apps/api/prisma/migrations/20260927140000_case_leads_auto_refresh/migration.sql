-- Leads that keep themselves current, and look-alike documents from the
-- duplicates engine.
--
-- A lead now says what in the case it hangs off (`via_*`): the evidence finding
-- it resembles, the evidence asset it duplicates, the watch that answered it.
-- "Show on board" and placement next to that evidence read these.
--
-- A look-alike document is an ASSET lead: it has no finding, and accepting it
-- adds the asset. No backfill: existing leads keep their finding and simply
-- have no `via_*` yet.

-- ─── Enums ────────────────────────────────────────────────────────────────────
-- `ADD VALUE IF NOT EXISTS` is idempotent and legal inside a transaction as long
-- as the new value is not used in it, so it replays safely across every tenant
-- schema.
ALTER TYPE "CaseLeadOrigin" ADD VALUE IF NOT EXISTS 'DUPLICATE';
-- One coalesced timeline entry per stretch of automatic refreshes, instead of
-- a LEAD_PROPOSED row per lead.
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'LEADS_GENERATED';

-- ─── Leads ────────────────────────────────────────────────────────────────────
ALTER TABLE "case_leads"
  ALTER COLUMN "finding_id" DROP NOT NULL,
  ADD COLUMN "via_finding_id" TEXT,
  ADD COLUMN "via_asset_id"   TEXT,
  ADD COLUMN "via_inquiry_id" TEXT,
  ADD COLUMN "details"        JSONB;

-- Finding leads stay unique per (case, finding) under the existing key, where
-- NULLs never collide. An asset lead is unique per (case, asset). Prisma cannot
-- express a partial index; the model's comment points here.
CREATE UNIQUE INDEX IF NOT EXISTS "case_leads_case_id_asset_id_asset_lead_key"
  ON "case_leads"("case_id", "asset_id")
  WHERE "finding_id" IS NULL;
