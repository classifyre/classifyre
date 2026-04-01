DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'InstanceLanguage'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "InstanceLanguage" AS ENUM ('ENGLISH');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'InstanceTimeFormat'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "InstanceTimeFormat" AS ENUM ('TWELVE_HOUR', 'TWENTY_FOUR_HOUR');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "instance_settings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "ai_enabled" BOOLEAN NOT NULL DEFAULT true,
  "language" "InstanceLanguage" NOT NULL DEFAULT 'ENGLISH',
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "time_format" "InstanceTimeFormat" NOT NULL DEFAULT 'TWELVE_HOUR',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "instance_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "instance_settings" (
  "id",
  "ai_enabled",
  "language",
  "timezone",
  "time_format",
  "created_at",
  "updated_at"
)
VALUES (
  1,
  true,
  'ENGLISH',
  'UTC',
  'TWELVE_HOUR',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
