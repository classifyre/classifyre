-- `relation_type` holds seven values across millions of rows, so an index on it
-- alone can never be selective. Every query that filters on it also pins an
-- endpoint, and the planner reaches for (from_type, from_id) or
-- (to_type, to_id) instead.
--
-- Measured on a 4.18M-row edges table: 36 lifetime scans against 131,075 and
-- 132,875 for those two, for 53 MB.
DROP INDEX IF EXISTS "edges_relation_type_idx";
