-- Governed data assets, phase G-2 (docs/prd/GOV-governed-data-assets.md R6):
-- what stewards say about the columns of a table.
CREATE TABLE IF NOT EXISTS "asset_column_annotations" (
  "asset_id" TEXT NOT NULL,
  "column_name" TEXT NOT NULL,
  "business_name" TEXT,
  "description" TEXT,
  "term_id" TEXT,
  "critical_data_element" BOOLEAN NOT NULL DEFAULT false,
  "classification" TEXT,
  "classification_reviewed_at" TIMESTAMP(3),
  "classification_reviewed_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" TEXT,
  CONSTRAINT "asset_column_annotations_pkey" PRIMARY KEY ("asset_id", "column_name"),
  CONSTRAINT "asset_column_annotations_asset_id_fkey" FOREIGN KEY ("asset_id")
    REFERENCES "assets" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "asset_column_annotations_term_id_fkey" FOREIGN KEY ("term_id")
    REFERENCES "glossary_terms" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "asset_column_annotations_term_id_idx" ON "asset_column_annotations" ("term_id");
