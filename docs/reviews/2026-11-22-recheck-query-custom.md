# Re-review: custom sources over SQL (QC4 fixes)

- Diff: `git diff 007c76c9..550651d9` (583c6fab fixes, 6168ede8 Helm comments, 5f40b089 lab Q6, 550651d9 docs and PRD)
- Checks: the two-axis review of `f768c9ab...007c76c9` (ef855852, cecc4896, 007c76c9)

**Verdict: one finding still open (c2, partly fixed).** Everything else is fixed.

## What I ran

- `pytest tests/test_query_custom.py tests/test_query_worker.py tests/test_query_neo4j.py`: 63 passed, 3 skipped.
- `ruff check` and `mypy` on `src/query src/notebook src/sources/custom`: clean.
- `jest src/data-query/query-catalog.masks.spec.ts`: 15 passed.
- Probe: `/private/tmp/claude-501/-Users-andre-development-classifyre/d80fc8f9-c204-49fb-a242-7a53266ef843/scratchpad/probe_custom_errors.py` (it reuses the notebook from `test_query_custom.py`).

## Spec

| Finding | Verdict | Evidence |
|---|---|---|
| c1 no default masking | **FIXED** | `Table(classify=...)` is checked in `query.py:116-128`. `derivedClassifications` (`query-catalog.service.ts:513-547`) reads it as a floor through `stricterClassification`, so findings can only raise it. There is a spec test. The docs say that a column left out of `classify` stays clear. |
| c2 error text leaks values | **PARTLY FIXED** | Exceptions raised inside `scan()` now report only their type and line (`runner.py` `scan`), and there is a test. Two paths still send the raw text, and the probe confirms both (below). |
| c3 the PRD contradicts itself | **FIXED** | fd 3, `RLIMIT_AS`, `query.enabled` and `custom_query_disabled` now appear only in the dated decisions (§5.8, lines 381-383) and in the POC history (line 50). |
| c4 job-only can be overridden | **FIXED** | `worker.py:332-333` adds the configured types to the defaults instead of replacing them. A parametrized test covers `ODBC`, an empty value and `MYSQL`. The Helm text and the docs say so. |
| a1 starter notebook | **FIXED** | `all_input_examples.json` has the commented cell. `test_the_starter_notebooks_sql_example_works_once_uncommented` runs it. |
| a2 lab acceptance | **FIXED** | Q6 joins `lab_support.main.tickets` with `lab_shop.public.customers`. `expected.json` comes from the notebook's own generator, so Q6 checks the plumbing (pushdown, join, gate), not the generator. That is what it is for. |
| a3 missing tests | **FIXED** | New tests: the deadline kill, a condition on a masked column, TIMESTAMP/TIMESTAMPTZ display, typed wire values, coercion, `classify` validation. |
| b Helm README | **FIXED** | 6168ede8 changes only comment lines in `values.yaml`, and the README still has 469 rows. `sqlGateway.maxSessions` shows its whole description. |

### c2: what still leaks

Probe output (`Maria Huber` stands for a value from the source):

```
load-time raise: status=error leaked=True
  Failed to read register.main.companies: The notebook of register: KeyError: 'officer Maria Huber born 1971-04-02'
scan raises SystemExit: status=error leaked=True
  Failed to read register.main.companies: The notebook of register: SystemExit: officer Maria Huber born 1971-04-02
```

1. **Load time.** In query mode `runtime.load()` runs every cell. A top-level cell that raises (setup, auth, a module-level fetch) reaches `source.py:241-243` as an error frame. `_describe` turns it into `KeyError: <message>`, and `custom.py` shows its first line. Only secrets are redacted.
2. **`BaseException`.** `runner.py` `scan` catches `Exception`. `SystemExit("…")` and other `BaseException`s skip the type-and-line wrapper and reach `query_scan`'s non-`ScanFailedError` branch (`source.py:657`), which shows them in full through `_describe`.

Suggested fix: cut the text on the parent side, so there is one place to check. While `_query_mode` is set, any error frame that is not a `ScanFailedError` (in `_start` and in `query_scan`) becomes `"<type> at cell <id>, line <n>"`, built from the frame's own traceback. The full text goes to the log, as `runner.py` already does. Add the two probe cases as tests.

## Standards

- Fixed:
  - `Filter` is now the shared `Predicate` in `query/predicate.py`, with no dependencies. That removes the copied `__str__`, the second operator list, the pass-through `_shown` and the matching of filters by their text.
  - `ScanCall` replaces the clump of six arguments.
  - `NotebookTimeoutError` replaces the text match.
  - `query_scan` returns its outcome.
  - `_table_assets` no longer returns `None`s.
  - `chunks()` and the timezone coercion each have one copy now.
  - `Filter` is in the editor completions.
- Left on purpose (judgement calls): the `_query_mode` flag, `_type_name` repeating the order of `_fits`, and the synchronous design that DuckDB's `scanner()` forces.
- **New, possible Duplicated Code across languages:** `COLUMN_CLASSIFICATIONS` (`notebook/query.py:58`) is a hand copy of the API's `CLASSIFICATIONS` (`governance-rules.ts:196`), and nothing pins the two together. A label the API drops would pass the notebook's check and then be ignored without a message: `rankOf` returns -1 and `stricterClassification` returns null. `sql-names.manifest.spec.ts` already pins one list across languages like this.
- **New, performance (judgement):** `derivedClassifications` now runs `asset.findMany({ metadata: { path: ['query'], equals: 'scan' } })` over every asset, every 30 s per schema (`CACHE_MS`). `Asset.metadata` has no index, and a JSON path test could not use a GIN index anyway. On a workspace with millions of file assets, that is a full table scan on the catalog's hot path. Narrow it to CUSTOM sources, or add an expression index.
