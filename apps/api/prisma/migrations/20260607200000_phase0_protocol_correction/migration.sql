-- Phase 0: Protocol correction
-- Drop old tables (MVP was unreleased so no data migration needed)
DROP TABLE IF EXISTS "hypothesis_evidence";
DROP TABLE IF EXISTS "case_hypothesis_support";
DROP TABLE IF EXISTS "case_findings";

-- Create case_findings: inferred observations anchored to evidence assets
CREATE TABLE "case_findings" (
    "id"               TEXT NOT NULL,
    "case_id"          TEXT NOT NULL,
    "case_evidence_id" TEXT NOT NULL,
    "finding_id"       TEXT NOT NULL,
    "note"             TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_findings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "case_findings_case_id_finding_id_key" UNIQUE ("case_id", "finding_id")
);

CREATE INDEX "case_findings_case_id_idx" ON "case_findings"("case_id");
CREATE INDEX "case_findings_case_evidence_id_idx" ON "case_findings"("case_evidence_id");

ALTER TABLE "case_findings"
    ADD CONSTRAINT "case_findings_case_id_fkey"
        FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE,
    ADD CONSTRAINT "case_findings_case_evidence_id_fkey"
        FOREIGN KEY ("case_evidence_id") REFERENCES "case_evidence"("id") ON DELETE CASCADE,
    ADD CONSTRAINT "case_findings_finding_id_fkey"
        FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE;

-- Create case_hypothesis_support: polymorphic link (evidence or finding) to hypothesis
CREATE TABLE "case_hypothesis_support" (
    "id"             TEXT NOT NULL,
    "hypothesis_id"  TEXT NOT NULL,
    "target_type"    TEXT NOT NULL,
    "target_id"      TEXT NOT NULL,
    "stance"         "EvidenceStance" NOT NULL DEFAULT 'SUPPORTS',
    "weight"         DECIMAL(3,2),
    "note"           TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_hypothesis_support_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "case_hypothesis_support_hypothesis_id_target_type_target_id_key"
        UNIQUE ("hypothesis_id", "target_type", "target_id")
);

CREATE INDEX "case_hypothesis_support_hypothesis_id_idx" ON "case_hypothesis_support"("hypothesis_id");
CREATE INDEX "case_hypothesis_support_target_type_target_id_idx" ON "case_hypothesis_support"("target_type", "target_id");

ALTER TABLE "case_hypothesis_support"
    ADD CONSTRAINT "case_hypothesis_support_hypothesis_id_fkey"
        FOREIGN KEY ("hypothesis_id") REFERENCES "case_hypotheses"("id") ON DELETE CASCADE;
