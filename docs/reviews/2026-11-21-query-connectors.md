# Review 2: query connectors (with test bed and docs)

- Diffs (this group is not contiguous in history):
  - `git diff c4ed4ae6^...c4ed4ae6`: refactor, x-query declaration and `QueryBinding`
  - `git diff cdf6d07b...805e4947`: `50574226` docs/PRD, `78b4de6e` connector runtime, `0c83c906` Meilisearch, `a69cab40` Neo4j, `16d17d95` scan stats, `73aaf096` uv sync fix, `33817d7b` lakehouse-lab (light), `805e4947` docs (light)
- Spec:
  - `docs/prd/QC-query-connectors.md` (primary)
  - `docs/prd/DQ-data-query.md`
  - POC `poc-payload/docs/connectors.md`, `src/fedsql`
  - The author's reviewer guide
- Known gaps, not reported:
  - Q2 and Q3 latency (no semi-join pushdown)
  - Not checked live: masked connector columns for a restricted user, the Data tab, MCP
  - Open BIC §9 findings
  - The rescan and migration upgrade note
- Checked by hand:
  - `meilisearch.py:185-198` pushes `!=` on strings, while its own docstring (`:9`) says string equality ignores case.
  - `neo4j.py:129` opens a session with no access mode.

**Verdict: not ready.** Three findings give wrong answers or show one group's rules to another (Spec c1, c2, c5). The Neo4j session isn't read-only.

## Standards

### Tooling at HEAD

`ruff check`, `ruff format --check` and `mypy --strict` are clean on the 19 changed CLI files. `tsc --noEmit` is clean in apps/api and apps/web.

### Documented-standard breaches

No hard violations.

- **Soft: plugin coupling.** CLAUDE.md asks for *"zero coupling between core and plugin implementations; plugins self-register via decorator"*. This is under the "Future" heading.
  - `connectors/__init__.py:32` keeps a central hand-written `_BINDINGS` map.
  - Bindings call sources' private members:
    - `meilisearch.py:60-62`: `client._session()`, `_base_url()`, `_request_timeout()`
    - `neo4j.py:122-129`: `client._neo4j`, `_database()`, `_driver()`
    - `attached_catalog.py:27`: writes `source._attach_alias`
    - `databricks.py`: `_access_token_value()`
- **Soft: JSONB index.** CLAUDE.md says *"JSONB … with GIN indexes"*. The new `scan_stats` column (migration `20261121120000`) has none. Nothing filters on it, so no index is needed.
- **Soft: UI components.** CLAUDE.md says *"Import UI components from `@workspace/ui/components/*`"*. `query-toolbar.tsx:146` uses a native `title=` tooltip, although `packages/ui/src/components/tooltip.tsx` exists. i18n is complete (en and de).

### Smells (judgement calls)

- **Possible Refused Bequest** (`arrow.py:185-199`): `LiveTable(ds.Dataset)` is built with `cls.__new__` and never runs `Dataset.__init__`; its fields are set from outside. Every inherited Dataset method except `schema` and `scanner` is broken. DuckDB's isinstance check probably forces the subclass. If DuckDB accepts a duck-typed object, use composition; otherwise document the constraint on the class.
- **Possible Duplicated Code:**
  - `arrow.py:400-452`: `_conjuncts` and `_unwrap` repeat the same depth and string-escape scanner.
  - `meilisearch.py:45-54` and `neo4j.py:102-110`: identical `label()` and `_where()`. Move them to `base.py`.
  - `postgres.py:53`, `mysql.py:45`, `databricks.py:31`: the same "attach once per database" alias bookkeeping.
  - `query-run.service.ts:1233-1237`: `scanStatsOf(meta.scans)` is called twice.
  - `runner.py:106-123`: `QUERY_GROUPS` repeats the `require_module` triples.
  - `warm.py:109` re-derives the binding groups.
  - Web: `scan-summary.ts:7` declares its own `ScanStatLike` instead of using the generated `QueryRunScanDto`.
- **Possible Shotgun Surgery:** the commit says "declare queryable source types once", but a new type still needs `x-query`, `_BINDINGS`, a branch in `tableAddress` (`sql-names.ts`) and an address literal.
  - `indexes`, `nodes` and `relationships` are written separately in `sql-names.ts:394-403` and `neo4j.py:33-34`.
  - Neo4j's special columns are defined in both `neo4j/source.py:340` and `connectors/neo4j.py:49-57`.
- **Possible Repeated Switches:**
  - `bindings.py:123-131` checks `isinstance(reader, ArrowConnector)` twice. Default `stats()` and `failure()` methods on `QueryBinding` would remove both checks.
  - `neo4j.py:44-76` branches on `kind == NODES` twice.
  - `tableAddress` is an if-cascade.
- **Possible Primitive Obsession:**
  - Columns are `{name, type}` dicts in the source, API and TS, but `tuple[str, str]` in `TableLocation`.
  - Relation names are used as lookup keys via `relation.strip('"')` (`arrow.py:166,171`).
  - `runner.py:147` reads `getattr(exc, "code", None)` instead of checking `isinstance(exc, ConnectorError)`.
- **Possible Speculative Generality:**
  - `record_columns(typed=…)` is never passed.
  - The list returned by `keep_installed` is ignored (`runner.py:120`).
  - `Neo4jConnector.__init__` only calls `super()` (`neo4j.py:99-100`).
- **Possible Message Chain** (`arrow.py:233`): `getattr(self.connector.source, "deadline", math.inf)`, although `SourceContext` already declares `deadline`.
- **Possible Divergent Change** (`query-toolbar.tsx`): the feature is mixed with unrelated Prettier reformatting.

## Spec

### (c) Implemented, but the implementation looks wrong

1. **String `IN` lists can be misread, and rows go missing** (R3: *"Pushdown never changes a result"*).
   - At `arrow.py:471-497`, an `is_in` value set prints its strings unescaped, and `_items` splits it on newlines. The round-trip check misses this.
   - Reproduced on DuckDB 2.0.0 and pyarrow 26.0.1: `WHERE s IN ('a",\n  "b', 'q', 'r')` reached the connector as `IN ('a','b','q','r')`, and the matching row was never returned. The local re-filter can't help, because the row never arrives.
   - Fix: don't push string `IN` sets that contain `"`, `,` or a newline; better, read the `pc.Expression` instead of parsing printed text.
2. **Meilisearch `!=` drops rows.** The module's own docstring says *"its string equality ignores case"* (`meilisearch.py:9`), yet `!=` on strings is pushed (`:36`, `:196`). `genre != "drama"` then also removes `Drama`, which SQL keeps. That breaks the "more, never fewer" claim. Push `!=` only for numbers and booleans.
3. **Meilisearch string escaping is not verified.** `json.dumps` (`meilisearch.py:211`) writes `\\` and `\n`. The test (`test_query_meilisearch.py:241`) only runs against a fake server. If Meilisearch only unescapes `\"`, values with backslashes or control characters match nothing and rows go missing. Check against a real server (≥1.13), or don't push such values.
4. **Neo4j pushes conditions that can't match the stored types.** `neo4j.py:79-90`: text and `JSON` columns convert values to text locally (`arrow.py:354`), but Cypher compares the raw property. `p = '5'` misses a node where `p` is the integer 5, and columns are typed from only 100 sampled nodes. Push only on columns recorded with one scalar type, never on `JSON` columns.
5. **Scan stats show one group's rules to another** (DQ §5.10: *"their own entries only, never other groups' rules"*).
   - Dataset inputs are registered under their real table names (`session.py:341,358`). Their `pushed` text, which includes the owning group's row-filter values and the dataset SQL's literals, is returned to the reader.
   - When a reader queries the same table directly and through a dataset, the two collide on that key, and one set of stats or failures is overwritten.
   - Connector errors name the input table ("Failed to read <input>").
6. **The "pushed" list overstates what was sent (R8).** `arrow.py:227-229` records every predicate DuckDB pushed, before the connector decides. Meilisearch drops conditions on attributes that aren't filterable, and Neo4j drops conditions on unknown columns. Yet the DTO (`data-query.dto.ts:245`) and the tooltip say "filters sent to the source".
7. **`withheld` is case-sensitive** (`session.py:326`), while masks match columns case-insensitively (`masks.py` `folded`). The safeguard misses `Email` against a mask on `email`. Nothing leaks today, because DuckDB won't push a condition on a mask's output. But `test_a_masked_column_is_never_filtered_at_the_source` never exercises `withheld`; a test should push a row filter on a masked column.

### (a) Missing or partial

- **Neo4j isn't read-only** (§5 QC0 item 6: *"`READ_ONLY` or equivalent"*). `neo4j.py:129` opens a default (write) session. Use `default_access_mode=READ_ACCESS`; that also blunts any gaps in identifier escaping.
- **R1 is only half tested.**
  - The declared `extensions` are parsed but never read or checked (`connectors/__init__.py:73`).
  - `test_the_job_queries_exactly_the_declared_types` is a tautology, since `QUERYABLE_SOURCE_TYPES = frozenset(declared_sources())`.
  - Nothing fails on a `_BINDINGS` entry with no declaration.
  - Otherwise c4ed4ae6 looks behaviour-neutral: `isTableShaped` and `tableAddress` map one-to-one onto the old type checks.
  - Keeping the bindings outside the scan code for import cost (§5.2) is the right call.
- **The uv-sync bug (73aaf096) was fixed for the query worker only.**
  - Scan Jobs and docker-mode scan subprocesses call `sync_group` with `persisted ∪ {group}`.
  - The image never recorded its baked groups (`Dockerfile:141`), so any on-demand sync removed file-processing, lineage and odbc.
  - `QUERY_GROUPS` also leaves out `odbc`.
  - **Fixed at HEAD**: 383fd5c4 writes the baked-groups state file (`Dockerfile:148-151`).

### (b) Scope creep and minor points

- The BIC PRD (348 lines) is bundled into 50574226 (docs only). `query-toolbar.tsx` has Prettier-only churn.
- The row cap counts all scans of a relation together (`arrow.py:246`), though the docstring says "one scan". A self-join of two 600k-row scans is refused.
- i18n has no plural forms ("1 tables · 1 requests").
- `_sample_columns` makes a `requests.Session` per index and never closes it.
- The docs say `source_id` appears "when every one has one". It is every *sampled* endpoint (100). The rule itself is reasonable.
- **OK as built:**
  - Connector clients are made per query and closed by `SourceBinding.close`, with no module-level caching, which matters in the warm worker.
  - Errors carry no response bodies or userinfo.
  - `scanStatsOf` bounds the stored JSON at about 1 MB.
  - `scans` defaults to `[]`, so older runs still load.
  - Relying on DuckDB 2.0 calling `scanner()` is acceptable as pinned. The local re-filter always runs when a filter was pushed. Its pyarrow semantics differ from DuckDB's on NaN equality.

## Fix order

1. String `IN` parsing (c1), Meilisearch `!=` (c2), scan stats showing dataset rules (c5).
2. Neo4j read-only session; verify or narrow c3 and c4.
3. Follow-ups: c6, c7, the R1 test gaps, the minor points.

**Summary:**

- **Standards:** no hard violations; 3 soft breaches and about 18 judgement calls. Worst: the `LiveTable` Refused Bequest, the never-initialised `Dataset` subclass.
- **Spec:** 7 wrong, 3 missing or partial (one already fixed at HEAD), and about 5 minor. Worst: string `IN` lists with quotes or newlines are misread, and matching rows silently disappear.
