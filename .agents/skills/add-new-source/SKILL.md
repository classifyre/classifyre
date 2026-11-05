---
name: add-new-source
description: Add a new ingestion source end-to-end in the Classifyre monorepo. Use when asked to create, scaffold, or update a source type across schemas, CLI extraction, API/Prisma/OpenAPI, and Web/UI source configuration. When reference implementations are available, use them to borrow proven connector patterns for config modeling, dependency isolation, and output/testing expectations.
---

# Add New Source

## Overview

Implement a new source by following the existing WordPress and Slack patterns. Keep schema, extraction behavior, API contracts, and UI source lists consistent so new source types work in create/test/run flows.

Treat `packages/schemas/src/schemas/ADDING_NEW_SOURCE.md` as a baseline only. Verify every step against current code before editing.

Prefer business-facing source naming/labels in UI and examples. Keep infrastructure/runtime execution controls in CLI environment variables when they are operational concerns rather than user-managed source configuration.

Schema contract rule (mandatory):
- Source config must use exactly these top-level sections: `type`, `required`, `masked`, `optional`, `sampling`, and optional `detectors`.
- `required` contains only mandatory ingestion fields.
- `masked` contains credentials/secrets (token/password/username/etc.) and is the only encrypted section.
- `optional` contains non-mandatory controls and should be grouped into nested sections (`optional.connection`, `optional.scope`, `optional.timeouts`, etc.) for clarity.
- `sampling` is required for every source and follows `SamplingConfig` (strategy + optional limit/controls). Keep it at the top level, not nested under `optional`.
- Do not add legacy top-level keys like `connection`, `credentials`, or flat option fields.

Relationship mapping rule (mandatory):
- Relationships are **typed edges**, built with `apps/cli/src/graph/edges.py` and buffered with `self.add_edge(...)`. Pick the builder by what traversing the edge means — the class is never a free-text argument:
  - `flow(upstream=..., downstream=...)` — data moves (a view over its tables, a table loaded from another). This is the only class that is lineage. Both ends are keyword-only because a reversed edge is silently wrong.
  - `references(...)` — foreign keys, "see also", mentions. Propagates nothing; never a lineage hop.
  - `contains(...)` — structural parent/child (project → workbook, archive → member).
  - `same_as(...)` — the same real object seen from two systems.
- Set `method` honestly: `SYSTEM_CATALOG` when the platform said so, `SQL_PARSED` when you read it out of SQL, `HEURISTIC` when you guessed. Pass `sql=` on a flow edge when there is SQL behind it.
- `SingleAssetScanResults.links` is for plain references only (the API turns each into a `REFERENCES` edge). **Do not also put lineage upstreams in `links`** — that draws a second, untyped edge beside the flow edge. (Databricks still does both for historical reasons; do not copy it.)
- Tabular sources get most of this for free from `BaseTabularSource._emit_relationship_edges`: implement `_collect_foreign_key_links` (→ `REFERENCE`) and `_collect_view_lineage` returning `ViewLineage(view, upstreams, sql, method)` (→ `FLOW`, with column mappings parsed from the SQL). Set `ViewLineage.method` when the upstreams themselves were parsed rather than read from a catalog.
- An upstream **outside the scan** is not dropped: point at it with `Ref.urn(...)` and the edge binds itself if that object is ever scanned.

Cross-system identity rule (mandatory for anything another connector could name):
- An asset's hash is scoped to its connector, so two connectors can only agree on an object through its URN (`apps/cli/src/utils/urn.py`). Tabular sources implement `_urn_authority()` (host:port, account, workspace — whatever another tool would have recorded) and the base builds `urn=` from `table_ref.fqn_parts`.
- Register a new platform's case-folding in **both** `apps/cli/src/utils/urn.py` (`_register(_Platform(...))`) and `apps/api/src/graph/urn.ts` (`PLATFORMS`). The two files must agree character for character.
- If the platform has its own SQL dialect, add it to `_DIALECTS` in `apps/cli/src/utils/sql_lineage.py` so view SQL is parsed with the right grammar.
- When the source is a layer *over* other systems (a BI tool, a federation engine), emit a `flow` edge from the underlying object's URN — built the way that object's own connector builds it — so lineage continues across the boundary. See `tableau/source.py` (`_table_urn`) and `dremio/source.py` (`_external_urn`).

Asset metadata contract rule (mandatory):
- Every asset a source emits carries two extra fields beyond `links`/`asset_type`: an `asset_kind` discriminator (free-form lowercase string: `file`, `image`, `page`, `comment`, `table`, `data_source`, ...) and a `metadata` dict of normalized, source-specific key/values. Both are set together by spreading `**self.metadata_fields("<kind>", {...})` into the `SingleAssetScanResults(...)` constructor — never set `metadata` directly. `asset_kind` is persisted as the asset's display type (the API prefers it over `asset_type`); `asset_type` remains the canonical content type used only for detector routing.
- The single source of truth for what each source may emit is the `x-asset-metadata` catalog at the top level of `packages/schemas/src/schemas/all_input_sources.json`. It has three keys: `contentTypes` (reusable property groups like `file`, `image`, `spreadsheet`, `tabularTable`, `comments`), and `sources` (keyed by the uppercased `source_type`, then by `asset_kind`). A source/kind entry composes reusable groups via `"use": [...]` and adds its own `properties` and `required`; the resolved field set is the union.
- When adding a source you **must** add a `sources.<SOURCE_TYPE>.<asset_kind>` entry for every kind you emit, declaring each metadata key (with `type` + `description`) and listing truly-mandatory keys under `required`. Reuse a shared `contentTypes` group via `use` instead of redeclaring common keys (e.g. file sources `use` `file`/`image`/`spreadsheet`; SQL sources `use` `tabularTable`).
- `metadata_fields` validates the emitted dict against the catalog: **strict (raises `AssetMetadataContractError`) under pytest or `CLASSIFYRE_STRICT_METADATA`**, otherwise a runtime warning. So undeclared keys or missing required keys fail your source's tests. Keys must mean the same thing across sources — reuse the normalized keys (`size_bytes`, `row_count`, `columns` as `[{name,type}]`, `page_count`, `encoding`, `image_width`/`image_height`, ...) rather than inventing source-specific synonyms.
- For file/object content, do not hand-roll extraction: call `extract_file_metadata(file_bytes, mime_type, file_name=...)` from `apps/cli/src/utils/file_metadata.py` (best-effort, never raises, returns normalized keys) and merge its non-null entries. Tabular sources get `database`/`table_name`/`table_type`/`schema`/`columns`/`row_count` for free from `BaseTabularSource._table_to_asset` — only override `_extra_asset_metadata` / `_estimate_row_count` for dialect-specific additions.
- Set the class attribute `source_type = "<source_type>"` on the source (it is uppercased to index the catalog). Add a conformance assertion to your source test and ensure `tests/test_assets_metadata_catalog.py` still passes.

Content pagination rule (mandatory for tabular sources):
- Inherit `BaseTabularSource`; do not write your own row loop. It already implements every sampling strategy: RANDOM/LATEST as one bounded query, ALL as a streamed scan in `fetch_content_pages` (keyset pagination when the table has a primary key, `cursor.fetchmany` otherwise), and AUTOMATIC as an incremental slice whose position is carried between runs in the sampling cursor.
- The page size is `sampling.rows_per_page` (default 100) for all of them. There is no `content_batch_size` and no `_fetch_all_rows_batched` any more.
- Never call `cursor.fetchall()` on an unbounded query — that is an OOM on a large table.
- What you override depends on the driver:
  - Parameter-less drivers (Snowflake, Databricks): override `_build_sampling_query` and `_fetch_one_page` to inline `LIMIT`/`OFFSET`, and return `False` from `_automatic_supports_keyset`.
  - Dialects with other syntax (MSSQL, Oracle): override `_limit_clause` / `_offset_clause`.
  - No DB-API driver at all (Dremio over REST): give `_connect` an object with the handful of cursor methods the base calls (`execute`, `fetchmany`, `fetchall`, `fetchone`, `description`) — see `dremio/client.py`.
- If the platform caps or truncates results silently, bound each query yourself so a short page is real evidence the table ended (see `JOB_ROW_WINDOW` in `dremio/client.py`). A failed read must raise, never return empty.
- Add a test named `test_<source>_fetch_content_pages_batches_for_all_strategy`: `rows_per_page=10` over 12 mock rows, asserting every row is yielded and how many queries were issued.
- `tests/test_source_strategy_conformance.py` checks statically that every registered source handles all four strategies; inheriting the base satisfies it.

Large payload contract (mandatory for file/object sources):
- **Never truncate a payload.** A file cut off at a byte cap is not a smaller file, it is a corrupt one: a Parquet loses the footer that indexes its row groups and yields *zero* rows, a zip loses its central directory. Worse, the readers used to return empty on such a payload, so the asset was recorded as scanned-and-empty — indistinguishable from a genuinely empty file. If a payload cannot be read, raise; do not return nothing.
- **Implement `_stream_object(ref) -> Iterator[bytes]`**, not just `_download_object`. `ObjectStorageSourceBase._open_object` spools that stream into a `SpooledTemporaryFile`: small payloads stay in memory, large ones roll over to disk, and every parser is handed the *handle*. `_download_object` remains only for the whole-bytes path (binary detectors) and for unmigrated providers.
- **`max_object_bytes` means "held in memory", not "the largest file we can read".** The size a scan survives is free disk. `max_file_bytes` (opt-in, unset by default) is the separate hard refusal — refusing is a policy choice, spilling is an implementation detail. Do not reintroduce a truncating cap.
- **Implement `_open_object_range_reader(ref)` and set `SUPPORTS_RANGE_READS = True`** when the backend serves byte ranges (HTTP `Range`, S3 `Range=`, GCS `start=/end=`, Azure `offset=/length=`). Use `HttpRangeReader` or `CallableRangeReader` from `utils/range_reader.py` wrapped in `open_buffered`. For a columnar format this turns "download 500 MB to read 100 rows" into a footer read plus one row group. `SUPPORTS_RANGE_READS` and the override are read at different moments (discovery decides from the listing, phase 2 opens the handle) and must agree.
- **Parsers take file objects.** `pdfplumber.open`, `docx.Document`, `openpyxl.load_workbook`, `zipfile.ZipFile` and `pyarrow.parquet.ParquetFile` all accept a handle — never wrap a payload back into `io.BytesIO(read_all(...))`. Use `as_binary_io` / `header` / `read_all` from `utils/payload.py`, and treat every `read_all` as a deliberate decision to materialize.
- **Fan-out caps stay, but are configurable**: `max_archive_members`, `max_archive_member_bytes`, `max_archive_total_bytes`, `max_embedded_files`. These bound how many assets one object becomes and are the only guard against a zip bomb — they are not size limits in disguise, so do not remove them. Declare them in the source's `optional.connection` schema block.
- **`pyarrow` pitfall**: an open-ended `iter_batches()` buffers *every* row group before yielding the first batch, which over a range-reading handle downloads the whole object. Always name the row groups (`_parquet_row_group_span` computes them from a row window, bounded at both ends), including for the column-classification sample.

Payload sampling window contract (mandatory for row-oriented sources):
- Route payload pages through `BaseSource.iter_asset_pages(..., asset_id=...)`. Omitting `asset_id` silently streams the whole file and loses the stored cursor; `tests/test_source_strategy_conformance.py` enforces this statically.
- Under AUTOMATIC the per-asset row cursor (`Asset.payload_cursor`) decides which rows a run reads. `exhausted` may only be set on positive proof the payload was covered — from the reader's row count where it is free (the Parquet footer), never inferred from "this window came back short". A window that read nothing is not evidence of an empty file, and banking it retires the asset from every later scan because the scan cache skips on that flag.
- A reader that fails must raise `TextExtractionCoverageError(FAILED)`, which routes into the incomplete-extraction tombstone so the next run retries. Returning empty instead records a clean, complete scan of a file that was never read.

## Canonical References

Use these files as the source of truth for current behavior:

- `packages/schemas/src/schemas/all_input_sources.json`
- `packages/schemas/src/schemas/all_input_examples.json`
- `packages/schemas/scripts/validate_examples.py`
- `apps/cli/src/sources/wordpress/source.py`
- `apps/cli/src/sources/slack/source.py`
- `apps/cli/src/sources/base.py` (see `metadata_fields` / `source_type`)
- `apps/cli/src/sources/asset_metadata.py` (catalog loader + `validate_metadata`)
- `apps/cli/src/utils/file_metadata.py` (`extract_file_metadata` — normalized file keys)
- `apps/cli/src/utils/payload.py` (`spool` / `as_binary_io` / `header` / `read_all` — where a payload lives)
- `apps/cli/src/utils/range_reader.py` (`HttpRangeReader`, `CallableRangeReader`, `open_buffered`)
- `apps/cli/src/sources/hugging_face/source.py` (canonical range-reading object source — `_stream_object` + `_open_object_range_reader`)
- `apps/cli/src/sources/s3_compatible_storage/source.py` (canonical SDK range reader via `CallableRangeReader`)
- `apps/cli/src/sources/local_folder/source.py` (`_open_object` override — a local file needs neither download nor spool)
- `apps/cli/src/pipeline/payload_window.py` (AUTOMATIC row cursor; `_advanced` decides `exhausted`)
- `apps/cli/tests/test_object_storage_download_efficiency.py` (family-wide: one read per object, size ceiling gone)
- `apps/cli/tests/test_range_reading.py` (range reads, embedded children of an oversized container)
- `apps/cli/src/sources/tabular_base.py` (`_table_to_asset` — tabular metadata defaults)
- `apps/cli/tests/test_assets_metadata_catalog.py` (catalog conformance test)
- `apps/cli/src/sources/__init__.py`
- `apps/cli/src/sources/mysql/source.py` (canonical tabular source — discovery, FK references, view lineage)
- `apps/cli/src/sources/dremio/source.py` (canonical REST-only tabular source — catalog-tree discovery, lineage with a fallback, cross-system URNs)
- `apps/cli/src/graph/edges.py` (typed edge builders) and `apps/cli/src/utils/urn.py` (cross-system names)
- `apps/cli/tests/test_tabular_lineage.py` (what view and foreign-key edges must look like)
- `apps/cli/src/sources/neo4j/source.py` (canonical graph source — Cypher SKIP/LIMIT batching, relationship links)
- `apps/cli/src/sources/mongodb/source.py` (canonical document/NoSQL source — collection-per-asset, cursor pagination)

Load detailed operational guidance from `references/classifyre-source-onboarding.md`.

## External Reference Pass (When Designing a New Source)

Before implementing a new connector, look for reference implementations to borrow design patterns from:

1. Search GitHub (e.g. DataHub, Airbyte, Meltano) for the closest source by platform and behavior.
2. Extract config shape, auth strategy, and secret handling from the reference.
3. Extract optional dependency strategy — how the reference isolates heavy dependencies.
4. Apply only the patterns that fit Classifyre architecture and product constraints.

Do not mirror reference internals blindly. Reuse design principles, not entire implementations.

## Patterns To Reuse (Regardless Of Source)

Prefer these patterns:

- Configuration models with explicit validation and clear error messages.
- Feature flags for expensive capabilities (lineage/profiling/relationships), defaulting to safe values.
- Auth-mode modeling with explicit mutual-exclusion validation for incompatible methods.
- Optional dependency isolation so one source's libraries do not break all sources.
- Clear separation between user recipe config and runtime/environment controls.

## Graph Database Sources (Neo4j Pattern)

For graph databases (Neo4j and future graph stores), use these conventions instead of the SQL/tabular patterns:

- **Assets = node labels** (one `SingleAssetScanResults` per label, not per table).
- **Content pagination**: Use `MATCH (n:Label) RETURN n SKIP $skip LIMIT $limit` with `sampling.content_batch_size` (default 500). This is the Cypher equivalent of SQL `LIMIT/OFFSET`.
- **No SQL `cursor.fetchall()`**: Use `_fetch_all_nodes_batched()` for ALL strategy — same contract as `_fetch_all_rows_batched()` in tabular sources.
- **Relationship links (mandatory)**: When `scope.include_relationships` is true, discover which labels are reachable from each label via any relationship and wire those label-asset hashes into `SingleAssetScanResults.links`.
- **UI category**: Graph databases get the `GRAPH_DATABASES` SourceCatalogCategory (separate from `DATABASES`).
- **NOT tabular**: Set the graph source to `false` in `TABULAR_SOURCE_TYPE_MAP` (`apps/web/components/json-schema-form.tsx`).
- See `apps/cli/src/sources/neo4j/source.py` as the canonical reference.

## Workflow

1. Run external reference pass for the new source platform (search GitHub for reference implementations).
2. Design source config shape and auth model using `required` / `masked` / `optional` plus required `sampling`.
3. Add source type to schema enum and input definition.
4. Add 2-3 realistic examples and validate them.
5. Add the source's `x-asset-metadata` catalog entry in `all_input_sources.json` (one block per `asset_kind` you emit, reusing `contentTypes` via `use`) — see the asset metadata contract rule above.
6. Regenerate CLI models and implement source extractor. Set `source_type` on the class and emit every asset via `**self.metadata_fields("<kind>", {...})`; for file content, merge `extract_file_metadata(...)`.
7. Add or update unit/integration tests for the new source, including edge assertions when the source has relations (class, direction, method, and that out-of-scope upstreams survive as URNs) and an asset-metadata conformance check. For tabular sources, include the `_fetch_content_pages_batches_for_all_strategy` test (see content pagination rule above). For file/object sources, add the source to `SOURCE_FACTORIES` in `tests/test_object_storage_download_efficiency.py` — that gives you the family-wide guards for free: one read per object, discovery downloads nothing, an object far past the memory cap is still scanned in full, and a hard limit refuses rather than truncates.
8. Update API + Prisma enum + OpenAPI + API client. Add the enum value to `apps/api/prisma/schema.prisma` and hand-write the migration (`prisma/migrations/<timestamp>_add_<source>_asset_type/migration.sql` containing `ALTER TYPE "AssetType" ADD VALUE '<TYPE>';`) — the same shape every earlier source used, and it needs no database. Add the source to the three description strings (`src/main.ts`, `scripts/generate-openapi-spec.ts`, `src/controllers/sources.controller.ts`).
9. Update web and UI: `packages/ui/src/lib/source-catalog.ts` (description/category/keywords), both icon maps in `packages/ui/src/components/source-icon.tsx`, `TABULAR_SOURCE_TYPE_MAP` in `apps/web/components/json-schema-form.tsx`, and `sourceTypes` in `apps/web/i18n/en.json` + `de.json`. Add an icon for any new `asset_kind` in `apps/web/lib/asset-kind.ts`, and for new metadata keys a label in `asset-metadata-card.tsx` plus both i18n files. These maps are typed `Record<SourceType, ...>`, so `bun run typecheck` in `apps/web` fails until every one is filled in.
10. Add the docs page (`apps/docs/app/sources/<slug>/page.mdx`), list the slug in `apps/docs/app/sources/_meta.js`, and add a row to the table in `apps/docs/app/sources/lineage/page.mdx` if the source produces lineage.
11. Run focused checks and report exactly what passed/failed.

Schema authoring notes:
- `all_input_sources.json`, `all_input_examples.json` and `assistant_knowledge.json` do not survive a `json.load`/`json.dump` round trip unchanged. Insert new blocks as text; never rewrite the whole file.
- When a source has several sign-in modes, `required` is a `oneOf` whose variants each carry a `const` discriminator (`auth_mode`). If `masked` is a `oneOf` of the **same length**, the form pairs them by index and shows one dropdown. Masked variants must be structurally distinct — two variants that both accept `{token}` make every token fail `oneOf`. When two modes share a credential shape, give `masked` fewer variants (as Databricks does) and validate the pairing in the source's `__init__`.
- Do not multiply `required` variants by sign-in method. If two variants would show the same fields (Dremio self-hosted with a token vs. with a password — both just a URL), they are one variant; the sign-in method belongs in `masked`. When *where it runs* and *how to sign in* are independent choices, leave the `const` discriminator off the `required` variants so the form renders two independent dropdowns instead of pairing them by index (Dremio: `required` = self-hosted | cloud, `masked` = password | token).
- If the source needs an optional driver, add a uv group in `apps/cli/pyproject.toml`, load it with `require_module`, and map it in `apps/cli/src/utils/dependency_groups.py`. A source that only needs base dependencies (`requests`) needs none of this.

If the new source requires operational runtime toggles (execution mode, remote endpoint, etc.), wire them through CLI env vars (for example `.env` in `apps/cli`) instead of schema input fields unless users must set them per-source.

## Required Checks

Run these checks after implementation:

```bash
cd packages/schemas
uv run python scripts/validate_examples.py

cd ../../apps/cli
uv run python scripts/generate_models.py
uv run pytest tests/test_<source_name>_source.py
uv run pytest tests/test_assets_metadata_catalog.py  # asset-metadata catalog conformance

cd ../api
bun run prisma:generate   # after hand-writing the enum migration
bun run openapi:generate
bun run check-types

cd ../../packages/api-client
bun run generate

cd ../../apps/web
bun run typecheck
```

Before API e2e checks, ensure migrations are applied to the active database (for example `bun run prisma:deploy` in deployed/shared environments).

## Discovery Helper

Use the bundled script to find hardcoded source literals that typically need updates:

```bash
python .claude/skills/add-new-source/scripts/find_source_touchpoints.py <workspace-root>
```

Use output to patch UI/API lists and mappings before finishing.
