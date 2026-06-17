-- Add phonetic_hash to asset_correlation_values as a second blocking key.
-- Non-null only for text-like labels; NULL for structured identifiers (email,
-- phone, SSN, …) where phonetics are meaningless.
ALTER TABLE "asset_correlation_values" ADD COLUMN "phonetic_hash" VARCHAR(64);

-- Composite index so "find all person/name values with phonetic code X" is O(log n).
CREATE INDEX "asset_correlation_values_label_phonetic_hash_idx"
  ON "asset_correlation_values"("label", "phonetic_hash");
