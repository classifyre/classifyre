# Re-review 2: query connectors (a0e423b5)

- Diff: `git diff 8b5782ef...a0e423b5` (11 files, +133/−39)
- Checks: [2026-11-22-recheck-query-connectors.md](2026-11-22-recheck-query-connectors.md)

**Verdict: ready to merge.** The c4 blocker is fixed. Two small follow-ups.

## Standards

- Tooling: ruff, ruff format and `mypy src/query` are clean. The new behaviours have tests.
- Fixed: the `Any` returns in `base.py`.
- **Partial:** Neo4j's computed columns are now one dict (`neo4j.py:47-55`), and `source.py` uses it for `reserved`. But `source.py:290-291,340-356` still spells out `element_id` / `source_element_id`.
- Possible Primitive Obsession: `_COMPUTED` (`neo4j.py:66-69`) tells computed columns apart with `cypher.endswith("`id`")`, a test on the Cypher text.
- Test style: `__import__("datetime")` at `test_query_connectors.py:498,501`.

## Spec

| Finding | Verdict | Evidence |
|---|---|---|
| c4 `to_batch` converts values quietly | **FIXED** | `arrow.py:376-380` checks each value with `_fits` (`:388-412`). Refused: 5.5, True and NaN in BIGINT; True in DOUBLE; 1 in BOOLEAN; a datetime in DATE; a date in TIMESTAMP; a tz mismatch. |
| c4 Neo4j date/time pushdown | **FIXED** | `neo4j.py:77` `_COMPARABLE = {"BIGINT","DOUBLE","BOOLEAN"}` |
| c4 test with an unsampled node | **FIXED** | A relationship holding 4.5 gives an error. A parametrized test covers each quiet conversion. |
| c6 pre-1.2 Meilisearch fallback | **FIXED** | `meilisearch.py:78-79`. Filters are reported only after a fetch returns below 400. |
| Tooltip wording | **FIXED** | `en.json:7422`, `de.json:7422` |

### Probe results

`/private/tmp/claude-501/-Users-andre-development-classifyre/68eddcfd-01ed-4561-8fb4-31afd63880d9/scratchpad/probe_fits.py`

- **Kept, and lossless:**
  - int into DOUBLE (1 becomes 1.0), so a JSON `1` in a column sampled as 1.5 is not wrongly refused;
  - 5.0 into BIGINT;
  - NaN and inf into DOUBLE;
  - an aware datetime into TIMESTAMPTZ, converted to UTC;
  - `neo4j.time.Date` / `DateTime`;
  - None in every type.
- **Refused:**
  - in BIGINT: 5.5, True, Decimal, `'5'`, values beyond int64, NaN, inf, 1e20;
  - into DOUBLE: 2**53+1;
  - in BOOLEAN: 1, 0, `"true"`;
  - into DATE: a datetime or a string;
  - in TIMESTAMP: a date, or an aware datetime;
  - in TIMESTAMPTZ: a naive datetime;
  - `[1, 2.5]` into BIGINT[].
- **Performance:** 100k rows × 6 columns take 0.68 s against about 0.2 s before. That is about 5 s more at the 1M-row cap. Acceptable next to driver fetch time.

### Follow-ups (not blocking)

1. **Pushdown can turn a type-drift error into a smaller answer.** This is worked out from Cypher and Meilisearch comparison rules, not run against a live server.
   - On a BIGINT column, a node holding `'5'` or 5.5 is dropped at the source by `p = 5`, `IN` or `>`. Without pushdown, `to_batch` would refuse it with "scan the source again".
   - No value is ever wrong. But whether you see the error depends on the filter.
   - The docstring at `neo4j.py:87` ("an error, never a missing row") overstates this. Soften the docstring and the R3 wording, or record it as known behaviour.
2. Finish moving `source.py`'s computed-column names onto `NODE_COLUMNS` / `RELATIONSHIP_COLUMNS`.

Latent only, since no connector yields them today: numpy scalars (`np.int64`, `np.bool_`) are refused.

### Tests

`pytest -k "query or connector or meilisearch or neo4j or manifest"`: **311 passed, 3 skipped**. `mypy src/query`: clean.

**Summary:**

- **Standards:** no hard violations; 3 judgement calls. Worst: computed-column names still spelled out in `source.py`.
- **Spec:** all 5 findings fixed; 2 follow-ups. Worst: a type-drift error can show up as a smaller answer when a condition is sent to the source.
