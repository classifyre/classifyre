-- Row filters (docs/prd/DQ-data-query.md §5.10): while a table has a policy,
-- each reader sees only the rows its rules select for them.
CREATE TABLE IF NOT EXISTS "asset_row_policies" (
    "asset_id" TEXT NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "asset_row_policies_pkey" PRIMARY KEY ("asset_id"),
    CONSTRAINT "asset_row_policies_asset_id_fkey" FOREIGN KEY ("asset_id")
        REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "asset_row_rules" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "principal_ref" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "asset_row_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "asset_row_rules_asset_id_fkey" FOREIGN KEY ("asset_id")
        REFERENCES "asset_row_policies"("asset_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "asset_row_rules_asset_id_idx" ON "asset_row_rules"("asset_id");

-- The row filters of the tables a run names, as it ran.
ALTER TABLE "query_runs" ADD COLUMN IF NOT EXISTS "row_filters" JSONB;

-- Access requests (§5.9): asked by a person, decided by the table's owner,
-- approved into an expiring Data reader grant for a group of the requester's.
CREATE TABLE IF NOT EXISTS "data_access_requests" (
    "id" TEXT NOT NULL,
    "scope_type" "GovernanceScope" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "requester_ref" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "role_key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "grant_id" TEXT,
    "grant_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "data_access_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "data_access_requests_status_created_at_idx" ON "data_access_requests"("status", "created_at");
CREATE INDEX IF NOT EXISTS "data_access_requests_requester_ref_idx" ON "data_access_requests"("requester_ref");
CREATE INDEX IF NOT EXISTS "data_access_requests_scope_type_scope_id_idx" ON "data_access_requests"("scope_type", "scope_id");
