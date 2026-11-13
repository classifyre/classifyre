-- SQL connections are opt-in per source and table (docs/prd/DQ-data-query.md
-- §5.7): BI tools reach a table only once it, or its source, is opened here.
CREATE TABLE IF NOT EXISTS "data_connection_exposures" (
    "id" TEXT NOT NULL,
    "scope_type" "GovernanceScope" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "opened_by" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "data_connection_exposures_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "data_connection_exposures_scope_type_scope_id_key" ON "data_connection_exposures"("scope_type", "scope_id");
