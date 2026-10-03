/**
 * The `terms` export column (SL3 R7.7), as SQL text for the export builders,
 * which assemble plain strings with positional parameters.
 *
 * Findings: the keys a finding is evidence of — an APPROVED binding of its
 * output to an APPROVED term (the compiler's rules: exact output, source
 * scope, value list, unique lookup), plus manual ABOUT references. Status is
 * left to the export's own filter, as in the findings `term` filter. The
 * binding table is small, so the correlated subquery stays cheap.
 *
 * Assets: the current asset-level keys from `asset_terms`.
 *
 * `binding-compiler.ts` is the reference; `semantic.integration.spec.ts`
 * holds this text to it.
 */

const PARTS = `(CASE WHEN gb.split_delimiter IS NULL
                     THEN ARRAY[f.matched_content]
                     ELSE string_to_array(f.matched_content, gb.split_delimiter) END)`;

const SELECTS_FINDING = `gb.status = 'APPROVED' AND NOT gb.no_meaning
        AND gb.detector_type = f.detector_type
        AND gb.finding_type = f.finding_type
        AND (gb.detector_type <> 'CUSTOM' OR gb.custom_detector_key = f.custom_detector_key)
        AND (cardinality(gb.source_ids) = 0 OR f.source_id = ANY(gb.source_ids))`;

export const FINDING_TERMS_SQL = `(
  SELECT string_agg(k.key, '; ' ORDER BY k.key)
    FROM (
      SELECT t.key
        FROM glossary_bindings gb
        JOIN glossary_terms t ON t.id = gb.term_id AND t.status = 'APPROVED'
       WHERE ${SELECTS_FINDING}
         AND (gb.mode = 'OUTPUT'
              OR (gb.mode = 'OUTPUT_VALUES' AND EXISTS (
                    SELECT 1 FROM unnest(${PARTS}) p
                     WHERE glossary_norm(p) = ANY(gb."values"))))
      UNION
      SELECT lk.key
        FROM glossary_bindings gb
        CROSS JOIN LATERAL unnest(${PARTS}) p
        CROSS JOIN LATERAL (
          SELECT (array_agg(t.key))[1] AS key, count(*) AS n
            FROM glossary_terms t
           WHERE t.scheme_id = gb.lookup_scheme_id
             AND t.kind = 'CONCEPT' AND t.status = 'APPROVED'
             AND CASE WHEN gb.lookup_match = 'CODES'
                      THEN t.codes @> ARRAY[btrim(p)]
                      ELSE t.match_keys @> ARRAY[glossary_norm(p)] END
        ) lk
       WHERE gb.mode = 'OUTPUT_LOOKUP' AND ${SELECTS_FINDING} AND lk.n = 1
      UNION
      SELECT t.key
        FROM glossary_references r
        JOIN glossary_terms t ON t.id = r.glossary_term_id
       WHERE r.role = 'ABOUT' AND r.entity_type = 'finding' AND r.entity_id = f.id
    ) k
)`;

export const ASSET_TERMS_SQL = `(
  SELECT string_agg(DISTINCT t.key, '; ' ORDER BY t.key)
    FROM asset_terms at
    JOIN glossary_terms t ON t.id = at.term_id
   WHERE at.asset_id = a.id AND at.gone_at IS NULL
)`;
