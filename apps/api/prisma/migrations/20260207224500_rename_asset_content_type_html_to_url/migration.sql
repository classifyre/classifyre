-- Align AssetContentType enum with scan schema: HTML -> URL
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AssetContentType'
      AND e.enumlabel = 'HTML'
  ) THEN
    ALTER TYPE "AssetContentType" RENAME VALUE 'HTML' TO 'URL';
  END IF;
END $$;
