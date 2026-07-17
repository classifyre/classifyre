-- Case leads: ranked exploration candidates that are triaged into evidence.
CREATE TYPE "CaseLeadOrigin" AS ENUM ('SEMANTIC_NEIGHBOR', 'INQUIRY', 'AUTOPILOT', 'MANUAL');
CREATE TYPE "CaseLeadStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DISMISSED');

CREATE TABLE "case_leads" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "finding_id" TEXT NOT NULL,
  "asset_id" TEXT,
  "origin" "CaseLeadOrigin" NOT NULL,
  "status" "CaseLeadStatus" NOT NULL DEFAULT 'PROPOSED',
  "rationale" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "importance" DOUBLE PRECISION,
  "similarity" DOUBLE PRECISION,
  "proposed_by" TEXT NOT NULL,
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "case_leads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_leads_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "case_leads_case_id_finding_id_key" ON "case_leads"("case_id", "finding_id");
CREATE INDEX "case_leads_case_id_status_idx" ON "case_leads"("case_id", "status");

-- Case events: the real-world chronology, distinct from the CaseActivity audit log.
CREATE TYPE "CaseEventPrecision" AS ENUM ('DAY', 'MONTH', 'YEAR');

CREATE TABLE "case_events" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "precision" "CaseEventPrecision" NOT NULL DEFAULT 'DAY',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "confidence" DOUBLE PRECISION,
  "origin" "AgentMemoryOrigin" NOT NULL DEFAULT 'OPERATOR',
  "verified_at" TIMESTAMP(3),
  "verified_by" TEXT,
  "finding_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "evidence_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "case_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "case_events_case_id_occurred_at_idx" ON "case_events"("case_id", "occurred_at");

-- New audit activity types for lead triage and chronology edits.
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'LEAD_PROPOSED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'LEAD_ACCEPTED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'LEAD_DISMISSED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'EVENT_ADDED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'EVENT_UPDATED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'EVENT_REMOVED';
