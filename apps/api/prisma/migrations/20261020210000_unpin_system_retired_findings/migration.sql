-- Findings the system resolved because their asset left the source (a full
-- scan that no longer listed it) or their uploaded file was deleted carried a
-- STATUS_CHANGED history entry. That entry is what an operator's resolve
-- writes, and the ingest reads it as a pin against re-opening: an asset that
-- came back with the same detections kept them resolved for good. Such
-- resolutions are now recorded as RESOLVED events; this rewrites the ones
-- already stored, in both history shapes (compact `e`/`x` codes and the legacy
-- `eventType`/`changeReason` keys). Findings an operator resolved are untouched.
UPDATE "findings" AS f
SET "history" = (
  SELECT jsonb_agg(
    CASE
      WHEN h.elem->>'e' = 'SC' AND h.elem->>'x' IN ('#asset-deleted', '#file-deleted')
        THEN jsonb_set(h.elem, '{e}', '"R"')
      WHEN h.elem->>'eventType' = 'STATUS_CHANGED'
        AND h.elem->>'changeReason' IN ('Asset deleted from source (full scan)', 'Uploaded source file deleted')
        THEN jsonb_set(h.elem, '{eventType}', '"RESOLVED"')
      ELSE h.elem
    END
    ORDER BY h.ord
  )
  FROM jsonb_array_elements(f."history") WITH ORDINALITY AS h(elem, ord)
)
WHERE jsonb_typeof(f."history") = 'array'
  AND (
    f."history" @> '[{"e": "SC", "x": "#asset-deleted"}]'
    OR f."history" @> '[{"e": "SC", "x": "#file-deleted"}]'
    OR f."history" @> '[{"eventType": "STATUS_CHANGED", "changeReason": "Asset deleted from source (full scan)"}]'
    OR f."history" @> '[{"eventType": "STATUS_CHANGED", "changeReason": "Uploaded source file deleted"}]'
  );
