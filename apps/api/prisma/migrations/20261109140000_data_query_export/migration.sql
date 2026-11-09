-- Query results exported as files: Excel, CSV, Parquet (docs/prd/DQ-data-query.md §5.6).
ALTER TABLE "query_runs" ADD COLUMN IF NOT EXISTS "result_format" TEXT;
ALTER TABLE "data_query_settings" ADD COLUMN IF NOT EXISTS "export_max_rows" INTEGER NOT NULL DEFAULT 1000000;
