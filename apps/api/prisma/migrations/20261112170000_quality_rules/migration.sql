-- Governed data assets, phase G-3 (docs/prd/GOV-governed-data-assets.md §5.4):
-- data quality rules, their evaluations and results, and the detector type of
-- the findings failing rules raise.
ALTER TYPE "DetectorType" ADD VALUE IF NOT EXISTS 'QUALITY';

CREATE TABLE IF NOT EXISTS "quality_rules" (
  "id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "column_name" TEXT,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "dimension" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "arguments" JSONB NOT NULL DEFAULT '{}',
  "operator" TEXT NOT NULL,
  "threshold" JSONB NOT NULL,
  "unit" TEXT NOT NULL,
  "severity" "Severity" NOT NULL DEFAULT 'MEDIUM',
  "business_impact" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quality_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quality_rules_asset_id_fkey" FOREIGN KEY ("asset_id")
    REFERENCES "assets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "quality_rules_asset_id_key_key" ON "quality_rules" ("asset_id", "key");
CREATE INDEX IF NOT EXISTS "quality_rules_asset_id_enabled_idx" ON "quality_rules" ("asset_id", "enabled");

CREATE TABLE IF NOT EXISTS "quality_evaluations" (
  "id" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "asset_ids" TEXT[],
  "runner_id" TEXT,
  "actor_ref" TEXT,
  "rules" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  CONSTRAINT "quality_evaluations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "quality_evaluations_started_at_idx" ON "quality_evaluations" ("started_at" DESC);

CREATE TABLE IF NOT EXISTS "quality_results" (
  "id" TEXT NOT NULL,
  "rule_id" TEXT NOT NULL,
  "evaluation_id" TEXT NOT NULL,
  "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "measured_value" DOUBLE PRECISION,
  "passed" BOOLEAN NOT NULL,
  "error" TEXT,
  CONSTRAINT "quality_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quality_results_rule_id_fkey" FOREIGN KEY ("rule_id")
    REFERENCES "quality_rules" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quality_results_evaluation_id_fkey" FOREIGN KEY ("evaluation_id")
    REFERENCES "quality_evaluations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "quality_results_rule_id_evaluated_at_idx" ON "quality_results" ("rule_id", "evaluated_at" DESC);
CREATE INDEX IF NOT EXISTS "quality_results_evaluation_id_idx" ON "quality_results" ("evaluation_id");
