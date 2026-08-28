-- Repair for environments that applied 20260827120000 before it gained the
-- `labels` column and its renamed cluster index.
--
-- That migration was amended after it had already been deployed. `migrate
-- deploy` skips a migration it has recorded as applied and does not verify the
-- checksum, so the amendment reached fresh installs and silently missed every
-- database that already had the original — which then failed at runtime with
-- `column "labels" of relation "correlation_pair_signatures" does not exist`.
--
-- Written to be a no-op where 20260827120000 was applied in its final form, so
-- fresh installs and already-drifted ones converge on the same schema.

ALTER TABLE "correlation_pair_signatures"
  ADD COLUMN IF NOT EXISTS "labels" TEXT[];

-- Prisma derives this index's name from the truncated column list; the first
-- version of the migration spelled it out one character differently.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname =
      'correlation_cluster_patterns_pattern_key_undecided_pairs_idx'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname =
      'correlation_cluster_patterns_pattern_key_undecided_pairs_ma_idx'
  ) THEN
    ALTER INDEX "correlation_cluster_patterns_pattern_key_undecided_pairs_idx"
      RENAME TO "correlation_cluster_patterns_pattern_key_undecided_pairs_ma_idx";
  END IF;
END $$;
