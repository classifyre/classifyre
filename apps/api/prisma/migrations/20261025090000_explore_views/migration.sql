-- Saved Explore views: starting points, how they are traced, and positions.
CREATE TABLE IF NOT EXISTS "explore_views" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "seed_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "view" TEXT,
  "kinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "depth" INTEGER NOT NULL DEFAULT 2,
  "direction" TEXT NOT NULL DEFAULT 'both',
  "positions" JSONB NOT NULL DEFAULT '{}',
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "explore_views_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "explore_views_updated_at_idx" ON "explore_views" ("updated_at");
