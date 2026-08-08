ALTER TABLE "asset_correlation_values"
ADD COLUMN "finding_id" TEXT;

CREATE INDEX "asset_correlation_values_finding_id_idx"
ON "asset_correlation_values"("finding_id");

ALTER TABLE "asset_correlation_values"
ADD CONSTRAINT "asset_correlation_values_finding_id_fkey"
FOREIGN KEY ("finding_id") REFERENCES "findings"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
