-- What links to an asset, found when the asset is ingested: `links ? hash`.
CREATE INDEX IF NOT EXISTS "assets_links_idx" ON "assets" USING GIN ("links");

-- The links scans reported were only hashes in a list until now, never edges,
-- so nothing that walks the graph could see them. Turn the existing ones into
-- REFERENCES edges; ingest keeps them up to date from here on.
INSERT INTO "edges" ("id", "from_type", "from_id", "to_type", "to_id", "relation_type", "confidence", "origin", "created_at")
SELECT gen_random_uuid(), 'asset', a."id", 'asset', t."id", 'REFERENCES', 1, 'INFERRED'::"EdgeOrigin", now()
FROM "assets" a
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(a."links") = 'array' THEN a."links" ELSE '[]'::jsonb END
) AS l(target)
JOIN "assets" t ON t."hash" = l.target
WHERE t."id" <> a."id"
ON CONFLICT ("from_type", "from_id", "to_type", "to_id", "relation_type") DO NOTHING;
