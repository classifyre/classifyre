-- What reading each connector table cost (docs/prd/QC-query-connectors.md §5.9):
-- `[{ table, requests, rows, pushed, ms, scans }]`, from the job's result.
ALTER TABLE "query_runs" ADD COLUMN IF NOT EXISTS "scan_stats" JSONB;
