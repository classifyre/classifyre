-- Notifications go to groups (IAM): each one carries the groups it was sent
-- to, and each person keeps their own read, importance and dismissal.

ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "audience_group_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Read state was shared by everyone in the workspace; it belongs to nobody in
-- particular, so it does not carry over.
DROP INDEX IF EXISTS "notifications_is_read_idx";
ALTER TABLE "notifications" DROP COLUMN IF EXISTS "is_read";
ALTER TABLE "notifications" DROP COLUMN IF EXISTS "read_at";

CREATE TABLE IF NOT EXISTS "notification_states" (
  "notification_id" TEXT NOT NULL,
  "actor_ref"       TEXT NOT NULL,
  "read_at"         TIMESTAMP(3),
  "important"       BOOLEAN,
  "dismissed_at"    TIMESTAMP(3),
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_states_pkey" PRIMARY KEY ("notification_id", "actor_ref"),
  CONSTRAINT "notification_states_notification_id_fkey" FOREIGN KEY ("notification_id")
    REFERENCES "notifications" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "notification_states_actor_ref_idx" ON "notification_states" ("actor_ref");

CREATE TABLE IF NOT EXISTS "notification_audiences" (
  "type"       "NotificationType" NOT NULL,
  "group_ids"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updated_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_audiences_pkey" PRIMARY KEY ("type")
);
