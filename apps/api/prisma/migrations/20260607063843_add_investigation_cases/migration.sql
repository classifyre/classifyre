-- CreateEnum
CREATE TYPE "EdgeOrigin" AS ENUM ('SOURCE_DERIVED', 'INFERRED');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "HypothesisStatus" AS ENUM ('PROPOSED', 'SUPPORTED', 'REFUTED', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "EvidenceStance" AS ENUM ('SUPPORTS', 'CONTRADICTS', 'NEUTRAL');

-- DropForeignKey
ALTER TABLE "custom_detector_training_examples" DROP CONSTRAINT "custom_detector_training_examples_custom_detector_id_fkey";

-- DropIndex
DROP INDEX "assets_metadata_idx";

-- DropIndex
DROP INDEX "custom_detector_extractions_pipeline_result_gin_idx";

-- DropIndex
DROP INDEX "findings_metadata_idx";

-- DropIndex
DROP INDEX "runner_assets_metadata_idx";

-- AlterTable
ALTER TABLE "assets" ALTER COLUMN "asset_type" DROP DEFAULT;

-- AlterTable
ALTER TABLE "custom_detector_extractions" ALTER COLUMN "extracted_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "custom_detector_training_examples" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "mcp_access_tokens" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sources" ALTER COLUMN "schedule_timezone" DROP NOT NULL;

-- CreateTable
CREATE TABLE "edges" (
    "id" TEXT NOT NULL,
    "from_type" TEXT NOT NULL,
    "from_id" TEXT NOT NULL,
    "to_type" TEXT NOT NULL,
    "to_id" TEXT NOT NULL,
    "relation_type" TEXT NOT NULL,
    "confidence" DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    "origin" "EdgeOrigin" NOT NULL DEFAULT 'INFERRED',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "CaseStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "assignee" TEXT,
    "created_by" TEXT,
    "conclusion" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_evidence" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "note" TEXT,
    "added_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_hypotheses" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "status" "HypothesisStatus" NOT NULL DEFAULT 'PROPOSED',
    "confidence" DECIMAL(3,2),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_hypotheses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hypothesis_evidence" (
    "id" TEXT NOT NULL,
    "hypothesis_id" TEXT NOT NULL,
    "case_evidence_id" TEXT NOT NULL,
    "stance" "EvidenceStance" NOT NULL DEFAULT 'SUPPORTS',
    "weight" DECIMAL(3,2),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hypothesis_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_notes" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "edges_from_type_from_id_idx" ON "edges"("from_type", "from_id");

-- CreateIndex
CREATE INDEX "edges_to_type_to_id_idx" ON "edges"("to_type", "to_id");

-- CreateIndex
CREATE INDEX "edges_relation_type_idx" ON "edges"("relation_type");

-- CreateIndex
CREATE UNIQUE INDEX "edges_from_type_from_id_to_type_to_id_relation_type_key" ON "edges"("from_type", "from_id", "to_type", "to_id", "relation_type");

-- CreateIndex
CREATE INDEX "cases_status_idx" ON "cases"("status");

-- CreateIndex
CREATE INDEX "cases_severity_idx" ON "cases"("severity");

-- CreateIndex
CREATE INDEX "cases_created_at_idx" ON "cases"("created_at");

-- CreateIndex
CREATE INDEX "case_evidence_case_id_idx" ON "case_evidence"("case_id");

-- CreateIndex
CREATE INDEX "case_evidence_entity_type_entity_id_idx" ON "case_evidence"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_evidence_case_id_entity_type_entity_id_key" ON "case_evidence"("case_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "case_hypotheses_case_id_idx" ON "case_hypotheses"("case_id");

-- CreateIndex
CREATE INDEX "hypothesis_evidence_hypothesis_id_idx" ON "hypothesis_evidence"("hypothesis_id");

-- CreateIndex
CREATE INDEX "hypothesis_evidence_case_evidence_id_idx" ON "hypothesis_evidence"("case_evidence_id");

-- CreateIndex
CREATE UNIQUE INDEX "hypothesis_evidence_hypothesis_id_case_evidence_id_key" ON "hypothesis_evidence"("hypothesis_id", "case_evidence_id");

-- CreateIndex
CREATE INDEX "case_notes_case_id_idx" ON "case_notes"("case_id");

-- AddForeignKey
ALTER TABLE "custom_detector_training_examples" ADD CONSTRAINT "custom_detector_training_examples_custom_detector_id_fkey" FOREIGN KEY ("custom_detector_id") REFERENCES "custom_detectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_evidence" ADD CONSTRAINT "case_evidence_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_hypotheses" ADD CONSTRAINT "case_hypotheses_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hypothesis_evidence" ADD CONSTRAINT "hypothesis_evidence_hypothesis_id_fkey" FOREIGN KEY ("hypothesis_id") REFERENCES "case_hypotheses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hypothesis_evidence" ADD CONSTRAINT "hypothesis_evidence_case_evidence_id_fkey" FOREIGN KEY ("case_evidence_id") REFERENCES "case_evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_notes" ADD CONSTRAINT "case_notes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "findings_asset_id_status_severity_detector_type_finding_type_id" RENAME TO "findings_asset_id_status_severity_detector_type_finding_typ_idx";
