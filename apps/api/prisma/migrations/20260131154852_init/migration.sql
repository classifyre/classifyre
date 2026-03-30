-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('WORDPRESS', 'SLACK');

-- CreateEnum
CREATE TYPE "RunnerStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'ERROR');

-- CreateEnum
CREATE TYPE "DetectorType" AS ENUM ('SECRETS', 'PII', 'TOXIC', 'NSFW', 'YARA');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'FALSE_POSITIVE', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "DetectorCategory" AS ENUM ('SECRETS', 'PII', 'CONTENT', 'THREAT');

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "config" JSONB NOT NULL,
    "current_run_id" TEXT,
    "runner_status" "RunnerStatus" DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "external_urn" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "subtype" TEXT,
    "preview" TEXT,
    "run_id" TEXT,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "source_id" TEXT NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detectors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "category" "DetectorCategory" NOT NULL,
    "description" TEXT,
    "documentation_url" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "default_severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "confidence_threshold" DECIMAL(3,2) NOT NULL DEFAULT 0.70,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "detectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL,
    "detector_id" TEXT NOT NULL,
    "detector_run_id" TEXT,
    "source_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "document_id" TEXT,
    "document_title" TEXT,
    "document_url" TEXT,
    "finding_type" TEXT NOT NULL,
    "category" TEXT,
    "severity" "Severity" NOT NULL,
    "confidence" DECIMAL(3,2) NOT NULL,
    "matched_content" TEXT NOT NULL,
    "redacted_content" TEXT,
    "context_before" TEXT,
    "context_after" TEXT,
    "location" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "resolution_reason" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detector_runs" (
    "id" TEXT NOT NULL,
    "detector_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "job_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "documents_total" INTEGER NOT NULL DEFAULT 0,
    "documents_scanned" INTEGER NOT NULL DEFAULT 0,
    "documents_failed" INTEGER NOT NULL DEFAULT 0,
    "findings_count" INTEGER NOT NULL DEFAULT 0,
    "findings_by_severity" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'running',
    "error_message" TEXT,
    "error_details" JSONB,
    "config_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "detector_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "false_positive_patterns" (
    "id" TEXT NOT NULL,
    "detector_id" TEXT NOT NULL,
    "source_id" TEXT,
    "pattern_type" TEXT NOT NULL,
    "pattern_value" TEXT NOT NULL,
    "reason" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "false_positive_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_detectors" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "detector_type" "DetectorType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_detectors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_type_idx" ON "assets"("type");

-- CreateIndex
CREATE INDEX "assets_external_urn_idx" ON "assets"("external_urn");

-- CreateIndex
CREATE INDEX "assets_run_id_idx" ON "assets"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "detectors_name_key" ON "detectors"("name");

-- CreateIndex
CREATE INDEX "detectors_enabled_idx" ON "detectors"("enabled");

-- CreateIndex
CREATE INDEX "detectors_category_idx" ON "detectors"("category");

-- CreateIndex
CREATE INDEX "findings_detector_id_idx" ON "findings"("detector_id");

-- CreateIndex
CREATE INDEX "findings_source_id_idx" ON "findings"("source_id");

-- CreateIndex
CREATE INDEX "findings_asset_id_idx" ON "findings"("asset_id");

-- CreateIndex
CREATE INDEX "findings_finding_type_idx" ON "findings"("finding_type");

-- CreateIndex
CREATE INDEX "findings_severity_idx" ON "findings"("severity");

-- CreateIndex
CREATE INDEX "findings_status_idx" ON "findings"("status");

-- CreateIndex
CREATE INDEX "findings_detected_at_idx" ON "findings"("detected_at");

-- CreateIndex
CREATE INDEX "findings_source_id_severity_idx" ON "findings"("source_id", "severity");

-- CreateIndex
CREATE INDEX "findings_finding_type_status_idx" ON "findings"("finding_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "findings_detector_id_source_id_document_id_matched_content__key" ON "findings"("detector_id", "source_id", "document_id", "matched_content", "location");

-- CreateIndex
CREATE INDEX "detector_runs_detector_id_idx" ON "detector_runs"("detector_id");

-- CreateIndex
CREATE INDEX "detector_runs_source_id_idx" ON "detector_runs"("source_id");

-- CreateIndex
CREATE INDEX "detector_runs_job_id_idx" ON "detector_runs"("job_id");

-- CreateIndex
CREATE INDEX "detector_runs_status_idx" ON "detector_runs"("status");

-- CreateIndex
CREATE INDEX "detector_runs_started_at_idx" ON "detector_runs"("started_at");

-- CreateIndex
CREATE INDEX "false_positive_patterns_detector_id_idx" ON "false_positive_patterns"("detector_id");

-- CreateIndex
CREATE INDEX "false_positive_patterns_source_id_idx" ON "false_positive_patterns"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "false_positive_patterns_detector_id_source_id_pattern_value_key" ON "false_positive_patterns"("detector_id", "source_id", "pattern_value");

-- CreateIndex
CREATE INDEX "source_detectors_source_id_idx" ON "source_detectors"("source_id");

-- CreateIndex
CREATE INDEX "source_detectors_detector_type_idx" ON "source_detectors"("detector_type");

-- CreateIndex
CREATE INDEX "source_detectors_enabled_idx" ON "source_detectors"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "source_detectors_source_id_detector_type_key" ON "source_detectors"("source_id", "detector_type");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_detector_id_fkey" FOREIGN KEY ("detector_id") REFERENCES "detectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_detector_run_id_fkey" FOREIGN KEY ("detector_run_id") REFERENCES "detector_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detector_runs" ADD CONSTRAINT "detector_runs_detector_id_fkey" FOREIGN KEY ("detector_id") REFERENCES "detectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detector_runs" ADD CONSTRAINT "detector_runs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "false_positive_patterns" ADD CONSTRAINT "false_positive_patterns_detector_id_fkey" FOREIGN KEY ("detector_id") REFERENCES "detectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "false_positive_patterns" ADD CONSTRAINT "false_positive_patterns_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_detectors" ADD CONSTRAINT "source_detectors_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
