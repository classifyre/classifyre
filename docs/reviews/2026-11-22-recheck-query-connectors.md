# Re-review: query connectors (fe5a4a37)

- Diff: `git diff 383fd5c4...fe5a4a37` (19 files, +546/−304)
- Checks: [2026-11-21-query-connectors.md](2026-11-21-query-connectors.md)
- Checked by hand: `to_batch` (`arrow.py:351`) builds columns with `pa.array(values, type=…)`. On pyarrow 26 this converts `5.5→5` (int64), `True→1.0` (double), datetime→date (date32), and aware→naive timestamp without raising. The docstring's "raises ConnectorError" does not hold for these.

**Verdict: not ready, with one narrow blocker (c4).** Everything else is fixed or reasonably left as is.

## Standards

### Tooling

`ruff check`, `ruff format --check` and `mypy src/query` are clean.

### Earlier findings

Fixed:
- `label` / `_where` duplication
- `_conjuncts` / `_unwrap` (the parser was replaced)
- the double `isinstance` checks in `bindings.py`
- the `getattr(...deadline)` chain
- `record_columns(typed=)`
- Neo4j's empty `__init__`
- `runner.py` `getattr(exc,"code")`
- `scanStatsOf` called twice

Accepted as skipped:
- the `LiveTable` subclass, now documented at `arrow.py:222`
- the central `_BINDINGS` registry, since CLAUDE.md lists self-registration under "Future"

### New (judgement calls)

- **Got worse:** Neo4j's special columns are now defined in three places: `neo4j.py:48` (`special`), `:60` (`_COMPUTED`) and `neo4j/source.py`.
- **Type erasure:** `base.py:146,151` declare `stats` / `failure` as returning `Any`, so `bindings.py:129,134` re-annotate locals. Use a `TYPE_CHECKING` import.
- **Possible Duplicated Code:**
  - `session.py:97` `_PRIVATE_NAMES` copies `worker.QUERY_DIRS` (`worker.py:117`) and the spill prefix (`session.py:312`).
  - `check_local_root` runs on the same paths at `session.py:435` and `:501`.
  - Two consecutive loops over `self._bindings.values()` (`:430`, `:433`).

## Spec

### Earlier findings

| Id | Verdict | Evidence |
|---|---|---|
| c1 string `IN` misread | **FIXED** | `arrow.py:448-451` reads the Arrow IPC buffer from `Expression.__reduce__()`. It never unpickles; the bytes are made by pyarrow in the same process. `:433` rebuilds the tree and checks `equals`; on any doubt it pushes nothing. A probe of 55 WHERE clauses matched plain DuckDB on all of them. Grafting the old parser back in fails `test_a_value_shaped_like_…`. |
| c2 Meilisearch `!=` on text | **FIXED** | `meilisearch.py:194`. `<`/`>` only go with numbers; `=`/`IN` on text can only return more rows. |
| c3 escaping | **FIXED (on the author's check)** | Rests on the author's test against a real Meilisearch 1.13. It could not be reproduced here. |
| c4 Neo4j types | **PARTIAL (blocker)** | See below. |
| Neo4j read-only | **FIXED** | `neo4j.py:151`, `test_every_session_is_read_only` |
| c5 dataset stats leak | **FIXED** | `session.py:505,775`. Relation names are unique per registration, so direct and dataset reads no longer collide. No logger, audit or EXPLAIN path exposes `pushed`. |
| c6 "pushed" overstated | **PARTIAL** | `meilisearch.py:61` records the filters before the pre-1.2 fallback (`:74`), which sends no filter, so they still show as sent. |
| c7 `withheld` case | **FIXED** | `session.py:486`, `arrow.py:254`. Reverting both `.lower()` calls makes the new test fail. |
| R1 manifest tests | **FIXED** | Both directions are checked, and the declared extensions must appear in the Dockerfile. |
| Row cap per scan, plurals, unclosed session | **FIXED** | `arrow.py:268`; the i18n strings avoid plurals; `source.py` uses `with`. |

### Blocker: c4, Neo4j pushdown can still drop rows

- Neo4j conditions go out only for "non-text" properties, but those types still come from a 100-node sample (`neo4j.py:68-79`).
- The new docstring says a value of another type "is an error, never a missing row". Because `to_batch` converts silently (see the hand check above), that is not true.
- Neo4j is schemaless, and mixed `date`/`datetime` or int/float values across nodes are common. Cypher compares the stored value:
  - `p = 5` is pushed;
  - a node with `p = 5.0` or `5.5` matches or misses differently than SQL over the converted column;
  - `d = date(...)` misses `datetime` values that SQL sees as that date.
- The same `5.5→5` truncation affects Meilisearch `=`/`<=` on BIGINT columns.
- **Fix, either:**
  - make `to_batch` strict: refuse non-integral floats into int, bool into double, and temporal type changes. `pa.array(..., safe=True)` does not cover Python objects, so check explicitly;
  - or push temporal and numeric conditions only on columns whose recorded type is exact.
- Add a test with an unsampled node of another type.

### Minor follow-ups

- **c6:** don't record filters as sent on the pre-1.2 Meilisearch fallback.
- **Tooltip:** a dataset entry with hidden filters says "filtered here, nothing sent to the source" (`en.json` `liveScans.table`). Filters were sent, just not shown.
- **Row counts:** a dataset's `rows` / `requests` reveal how many source rows passed the owning group's row filter. This is a small inference channel; accept it or round it.
- **`columns_hidden`** still names the input table, not the dataset (`session.py:571`).
- **pyarrow internals:** pushdown depends on pyarrow's private serialisation and `Expression._call`. An upgrade can only switch pushdown off, never change results, and `test_pushed_filters_become_predicates` would catch it.

### Tests

- `pytest -k "query or connector or meilisearch or neo4j or manifest"`: **299 passed, 3 skipped**.
- `mypy src/query`: clean.
- Probe `/private/tmp/claude-501/-Users-andre-development-classifyre/68eddcfd-01ed-4561-8fb4-31afd63880d9/scratchpad/probe_c1.py`: 55 WHERE clauses, 0 rows dropped.
  - Covered: IN with quotes and newlines, NULL in IN, NOT IN, IS [NOT] DISTINCT FROM, LIKE/ILIKE/COLLATE, NaN/±0/inf, casts, booleans, DATE/TIMESTAMP/TIMESTAMPTZ under Europe/Berlin, BETWEEN, nested AND/OR/NOT, subquery IN, coalesce, int64 max.
- Mutation checks: both the c1 and c7 tests fail when their fix is reverted.

**Summary:**

- **Standards:** no hard violations; 4 judgement calls. Worst: Neo4j special columns now defined in three places.
- **Spec:** 8 fixed, 2 partial, 4 minor follow-ups. Worst: c4, sampled Neo4j types plus silent conversions in `to_batch` can still drop rows.
