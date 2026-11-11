-- A person's saved SQL over the workspace's tables (docs/prd/DQ-data-query.md
-- phase 3). Kept per user by actor reference, like query runs: nobody ever
-- sees another's. Search_path puts every workspace's copy in its own schema.
CREATE TABLE IF NOT EXISTS "saved_queries" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sql" TEXT NOT NULL,
  "actor_ref" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "saved_queries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "saved_queries_actor_ref_updated_at_idx" ON "saved_queries" ("actor_ref", "updated_at" DESC);
