-- Data requests (docs/prd/DR-data-requests.md): Case.kind, data_requests, and data_request_deliveries.

ALTER TABLE "cases"
  ADD COLUMN IF NOT EXISTS "kind" "CaseKind" NOT NULL DEFAULT 'INVESTIGATION';

CREATE INDEX IF NOT EXISTS "cases_kind_idx" ON "cases"("kind");

CREATE TABLE IF NOT EXISTS "data_requests" (
  "case_id" TEXT NOT NULL,
  "requester_ref" TEXT NOT NULL,
  "route_group_id" TEXT NOT NULL,
  "audience_group_id" TEXT NOT NULL,
  "assignee_ref" TEXT,
  "state" "DataRequestState" NOT NULL DEFAULT 'DRAFT',
  "spec" JSONB NOT NULL DEFAULT '{"tables":[],"joins":[],"pins":[]}',
  "spec_version" INTEGER NOT NULL DEFAULT 1,
  "draft_sql" TEXT NOT NULL DEFAULT '',
  "sql_edited" BOOLEAN NOT NULL DEFAULT false,
  "last_check" JSONB,
  "last_check_sql_hash" TEXT,
  "dataset_asset_id" TEXT,
  "delivered_version" INTEGER,
  "decline_reason" TEXT,
  "submitted_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "data_requests_pkey" PRIMARY KEY ("case_id")
);

DO $$ BEGIN
  ALTER TABLE "data_requests"
    ADD CONSTRAINT "data_requests_case_id_fkey"
    FOREIGN KEY ("case_id") REFERENCES "cases"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "data_requests"
    ADD CONSTRAINT "data_requests_dataset_asset_id_fkey"
    FOREIGN KEY ("dataset_asset_id") REFERENCES "shared_datasets"("asset_id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "data_requests_route_group_id_state_idx"
  ON "data_requests"("route_group_id", "state");

CREATE INDEX IF NOT EXISTS "data_requests_requester_ref_idx"
  ON "data_requests"("requester_ref");

CREATE INDEX IF NOT EXISTS "data_requests_dataset_asset_id_idx"
  ON "data_requests"("dataset_asset_id");

CREATE TABLE IF NOT EXISTS "data_request_deliveries" (
  "id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "round" INTEGER NOT NULL,
  "dataset_asset_id" TEXT NOT NULL,
  "dataset_version" INTEGER NOT NULL,
  "sql_snapshot" TEXT NOT NULL,
  "spec_snapshot" JSONB NOT NULL,
  "mode" "DataRequestDeliveryMode" NOT NULL,
  "delivered_by" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "data_request_deliveries_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "data_request_deliveries"
    ADD CONSTRAINT "data_request_deliveries_case_id_fkey"
    FOREIGN KEY ("case_id") REFERENCES "data_requests"("case_id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "data_request_deliveries_case_id_round_key"
  ON "data_request_deliveries"("case_id", "round");

CREATE INDEX IF NOT EXISTS "data_request_deliveries_case_id_idx"
  ON "data_request_deliveries"("case_id");
