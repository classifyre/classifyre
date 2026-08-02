-- Repair source configs that point at custom detectors which no longer exist.
--
-- A source carries its custom-detector selection in two shapes:
--   config.custom_detectors  -- array of detector IDs (the UI writes IDs, but
--                               agents and older configs also wrote keys)
--   config.detectors[]       -- entries of { type: 'CUSTOM',
--                               custom_detector_key: '<key>' }
-- Deleting a detector used to clear only exact-ID matches from the first shape,
-- so key-valued entries and detectors[] entries survived the delete. Every
-- later save of such a source was then rejected with
-- "Unknown or inactive custom detectors: <key>", which wedged the source form.
--
-- This migration brings existing rows in line with the new invariant:
--   1. key-valued custom_detectors entries are rewritten to the detector ID
--      (so a later key rename cannot orphan them again),
--   2. custom_detectors entries matching neither an ID nor a key are dropped,
--   3. detectors[] CUSTOM entries whose key matches no live detector are
--      dropped (an ID stored where a key belongs is rewritten to the key).
-- Deactivated detectors are deliberately left in place: deactivation pauses a
-- detector, it does not unconfigure it.
--
-- Replayed once per tenant schema by database-migrations.ts, so every statement
-- is unqualified (it lands in whichever ns_<hex32> schema search_path points at)
-- and idempotent — re-running it over already-clean configs is a no-op.

-- 1 + 2. Normalize config.custom_detectors to live detector IDs.
UPDATE sources s
SET config = jsonb_set(
  s.config,
  '{custom_detectors}',
  COALESCE(
    (
      SELECT jsonb_agg(DISTINCT resolved.id)
      FROM jsonb_array_elements_text(s.config->'custom_detectors') AS elem(value)
      JOIN LATERAL (
        SELECT d.id
        FROM custom_detectors d
        WHERE d.id = elem.value OR d.key = elem.value
        LIMIT 1
      ) AS resolved ON TRUE
    ),
    '[]'::jsonb
  )
)
WHERE jsonb_typeof(s.config->'custom_detectors') = 'array'
  AND EXISTS (
    -- Only touch rows that actually need it: an entry that is not already a
    -- live detector ID (either a key to rewrite, or a dangling reference).
    SELECT 1
    FROM jsonb_array_elements_text(s.config->'custom_detectors') AS elem(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM custom_detectors d WHERE d.id = elem.value
    )
  );

-- 3. Drop / repair CUSTOM entries in config.detectors.
UPDATE sources s
SET config = jsonb_set(
  s.config,
  '{detectors}',
  COALESCE(
    (
      SELECT jsonb_agg(fixed.entry)
      FROM (
        SELECT
          CASE
            -- Built-in detector: untouched.
            WHEN upper(COALESCE(entry->>'type', '')) <> 'CUSTOM' THEN entry
            -- Key names a live detector: untouched.
            WHEN EXISTS (
              SELECT 1 FROM custom_detectors d
              WHERE d.key = COALESCE(
                entry->>'custom_detector_key',
                entry->'config'->>'custom_detector_key'
              )
            ) THEN entry
            -- An ID stored where the key belongs: rewrite to the key.
            WHEN entry->>'custom_detector_key' IS NOT NULL AND EXISTS (
              SELECT 1 FROM custom_detectors d
              WHERE d.id = entry->>'custom_detector_key'
            ) THEN jsonb_set(
              entry,
              '{custom_detector_key}',
              to_jsonb((
                SELECT d.key FROM custom_detectors d
                WHERE d.id = entry->>'custom_detector_key'
              ))
            )
            WHEN entry->'config'->>'custom_detector_key' IS NOT NULL AND EXISTS (
              SELECT 1 FROM custom_detectors d
              WHERE d.id = entry->'config'->>'custom_detector_key'
            ) THEN jsonb_set(
              entry,
              '{config,custom_detector_key}',
              to_jsonb((
                SELECT d.key FROM custom_detectors d
                WHERE d.id = entry->'config'->>'custom_detector_key'
              ))
            )
            -- Dangling reference: dropped (NULL is skipped by jsonb_agg).
            ELSE NULL
          END AS entry
        FROM jsonb_array_elements(s.config->'detectors') AS entry
      ) AS fixed
      WHERE fixed.entry IS NOT NULL
    ),
    '[]'::jsonb
  )
)
WHERE jsonb_typeof(s.config->'detectors') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(s.config->'detectors') AS entry
    WHERE upper(COALESCE(entry->>'type', '')) = 'CUSTOM'
      AND NOT EXISTS (
        SELECT 1 FROM custom_detectors d
        WHERE d.key = COALESCE(
          entry->>'custom_detector_key',
          entry->'config'->>'custom_detector_key'
        )
      )
  );
