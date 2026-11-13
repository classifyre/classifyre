-- SQL connections (docs/prd/DQ-data-query.md §5.7): BI tools and drivers sign
-- in over the PostgreSQL wire protocol with a per-person credential. Only a
-- SCRAM-SHA-256 verifier is kept, never the password.
CREATE TABLE IF NOT EXISTS "data_connections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "person_ref" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "scram_salt" TEXT,
    "scram_iterations" INTEGER,
    "scram_stored_key" TEXT,
    "scram_server_key" TEXT,
    "secret_preview" TEXT,
    "scope_source_ids" TEXT[] NOT NULL DEFAULT '{}',
    "scope_asset_ids" TEXT[] NOT NULL DEFAULT '{}',
    "issued_by" TEXT,
    "revealed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "last_used_ip" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "revoke_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "data_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "data_connections_username_key" ON "data_connections"("username");
CREATE INDEX IF NOT EXISTS "data_connections_person_ref_idx" ON "data_connections"("person_ref");
CREATE INDEX IF NOT EXISTS "data_connections_revoked_at_idx" ON "data_connections"("revoked_at");

CREATE TABLE IF NOT EXISTS "data_connection_blocks" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "scope_type" "GovernanceScope" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "blocked_by" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "data_connection_blocks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "data_connection_blocks_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "data_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "data_connection_blocks_connection_id_scope_type_scope_id_key" ON "data_connection_blocks"("connection_id", "scope_type", "scope_id");
CREATE INDEX IF NOT EXISTS "data_connection_blocks_scope_type_scope_id_idx" ON "data_connection_blocks"("scope_type", "scope_id");

-- Runs say whose they are and how they came: the per-person cap and the
-- usage card count people, not tokens or connections.
ALTER TABLE "query_runs" ADD COLUMN IF NOT EXISTS "person_ref" TEXT;
ALTER TABLE "query_runs" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'rest';
ALTER TABLE "query_runs" ADD COLUMN IF NOT EXISTS "connection_id" TEXT;
UPDATE "query_runs" SET "person_ref" = "actor_ref" WHERE "person_ref" IS NULL AND "actor_ref" LIKE 'user:%' AND "actor_ref" NOT LIKE '%@%';
CREATE INDEX IF NOT EXISTS "query_runs_person_ref_status_idx" ON "query_runs"("person_ref", "status");
