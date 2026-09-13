-- (asset_id, value_hash) is the only identity a correlation value has.
--
-- The surrogate `id` was generated on every insert, read by nothing, targeted
-- by no foreign key, and never used for a lookup: 0 scans against 68,758 on the
-- unique index enforcing the real key. It cost a 48 MB b-tree plus 37 bytes a
-- row on a 607k-row table.
--
-- The existing unique index is PROMOTED rather than rebuilt: `USING INDEX`
-- adopts it in place and renames it to the constraint name, so 144 MB that is
-- already exactly correct is not re-sorted.
ALTER TABLE "asset_correlation_values" DROP CONSTRAINT "asset_correlation_values_pkey";
ALTER TABLE "asset_correlation_values" DROP COLUMN "id";
ALTER TABLE "asset_correlation_values"
  ADD CONSTRAINT "asset_correlation_values_pkey"
  PRIMARY KEY USING INDEX "asset_correlation_values_asset_id_value_hash_key";
