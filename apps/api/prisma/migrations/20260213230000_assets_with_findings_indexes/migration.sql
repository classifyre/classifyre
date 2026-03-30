-- Improve assets-with-findings endpoint query performance
CREATE INDEX "findings_asset_id_last_detected_at_idx"
ON "findings"("asset_id", "last_detected_at" DESC);

CREATE INDEX "findings_asset_id_status_severity_detector_type_finding_type_idx"
ON "findings"("asset_id", "status", "severity", "detector_type", "finding_type");
