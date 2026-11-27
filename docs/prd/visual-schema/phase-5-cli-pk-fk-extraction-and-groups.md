# Phase 5 · CLI Column-Level PK/FK Extraction & Optional Visual Polish

| | |
| --- | --- |
| **Goal** | Upgrade SQL scanners in `apps/cli` so real column-level foreign keys, constraint names, primary keys, and column nullability flow into `QueryCatalogDto` automatically (replacing heuristic column pairing for scanned SQL databases); add optional Visual Schema polish (Group Frames & DBML export) |
| **Depends on** | Phase 1 (`QueryCatalogService` already reads `primary_keys`, `nullable`, and column-level `FOREIGN_KEY` `Edge.fieldMappings`/`metadata`) |
| **DB Migrations** | **None.** `Asset.metadata` (`JsonB`) and `Edge.fieldMappings` / `Edge.metadata` (`JsonB`) already exist in [`apps/api/prisma/schema.prisma`](../../../apps/api/prisma/schema.prisma#L2154-L2210) |

---

## 1. CLI Primary Key & Nullability Persistence

### Current Gap
- [`apps/cli/src/sources/tabular_base.py#L342-L374`](../../../apps/cli/src/sources/tabular_base.py#L342-L374) already implements `_get_primary_key_columns(table_ref)` across PostgreSQL, MSSQL, Oracle, BigQuery, Redshift, Athena, Trino, Dremio, ODBC, and base `information_schema`.
- However, `_table_to_asset()` ([`tabular_base.py#L954-L1008`](../../../apps/cli/src/sources/tabular_base.py#L954-L1008)) only saves `columns` (`[{ name, type }]`) and `row_count` — it **never writes `primary_keys` or `nullable` into `asset_metadata`**.

### Changes
1. **`apps/cli/src/utils/file_metadata.py` (`build_columns`):**
   - Extend signature backward-compatibly:
     ```python
     def build_columns(
         names: list[str],
         types: dict[str, str] | None = None,
         *,
         primary_keys: set[str] | list[str] | None = None,
         nullable: dict[str, bool] | None = None,
     ) -> list[dict[str, Any]]:
     ```
   - Emit `{"name": name, "type": type_str}` as before, adding `"is_primary_key": True` only when present and `"nullable": bool` only when known (keeps metadata compact).
2. **`apps/cli/src/sources/tabular_base.py`:**
   - In `_available_column_types` (or new `_cached_column_nullability`), optionally select `is_nullable` alongside `column_name, data_type` in `information_schema.columns` (with safe fallback when overridden by dialects returning `(name, type)`).
   - In `_table_to_asset()`, fetch `pk_columns = self._get_primary_key_columns(table_ref)`:
     - Pass `primary_keys=pk_columns` into `build_columns(...)`.
     - Also set `asset_metadata["primary_keys"] = pk_columns` when non-empty.

---

## 2. CLI Column-Level Foreign Key Extraction

### Current Gap
- `_collect_foreign_key_links(tables)` in `postgresql`, `mssql`, `oracle`, `snowflake`, and `odbc` currently returns `dict[tuple[str, ...], set[tuple[str, ...]]]` — table-to-table pairs only — discarding `constraint_name`, `source_column`, and `target_column`.
- `_emit_relationship_edges()` ([`tabular_base.py#L1020-L1054`](../../../apps/cli/src/sources/tabular_base.py#L1020-L1054)) emits `references(Ref.asset(source_hash), Ref.asset(target_hash), type=ReferenceType.FOREIGN_KEY)` with no column details.

### Changes
1. **Introduce typed `ForeignKeyDetail` dataclass in `tabular_base.py`:**
   ```python
   @dataclass(frozen=True)
   class ForeignKeyDetail:
       source_key: tuple[str, ...]
       target_key: tuple[str, ...]
       source_column: str
       target_column: str
       constraint_name: str | None = None
   ```
2. **Add `_collect_foreign_key_details(tables) -> list[ForeignKeyDetail]`** (default `[]`), while keeping `_collect_foreign_key_links` working for any dialect not yet upgraded.
3. **Update SQL connectors to return column pairs & constraint names:**
   - **PostgreSQL** (`apps/cli/src/sources/postgresql/source.py`): join `pg_attribute` on `fk.conkey` / `fk.confkey` (preserving ordinal order via `unnest(...) WITH ORDINALITY`) and select `fk.conname AS constraint_name`.
   - **MSSQL** (`apps/cli/src/sources/mssql/source.py`): join `sys.foreign_key_columns fkc` + `sys.columns` for parent/referenced column names + `fk.name`.
   - **Oracle** (`apps/cli/src/sources/oracle/source.py`): join `all_cons_columns` on `src.constraint_name` and `tgt.constraint_name` matching `position`.
   - **MySQL / MariaDB** (if inheriting or overriding): query `information_schema.KEY_COLUMN_USAGE` where `REFERENCED_TABLE_NAME IS NOT NULL`.
   - **ODBC** (`apps/cli/src/sources/odbc/source.py`): `cursor.foreignKeys(...)` already returns `FKCOLUMN_NAME`, `PKCOLUMN_NAME`, and `FK_NAME` on each row!
   - **Snowflake** (`apps/cli/src/sources/snowflake/source.py`): `SHOW IMPORTED KEYS` already returns `fk_column_name`, `pk_column_name`, and `fk_name`.
4. **Emit column details on `FOREIGN_KEY` `Edge`:**
   - Group `ForeignKeyDetail` rows by `(source_hash, target_hash)` (matching the `Edge` unique key `[fromType, fromId, toType, toId, relationType]`).
   - Pass `metadata={"foreign_keys": [{"fromColumn": ..., "toColumn": ..., "constraintName": ...}, ...]}` on `references(...)` so multiple FKs between the same two tables (e.g. `orders.billing_address_id` and `orders.shipping_address_id` → `addresses.id`) are preserved cleanly without violating the `Edge` unique constraint!
   - Phase 1's `QueryCatalogService` already unpacks `edge.metadata.foreign_keys` into individual `QueryCatalogRelationDto` items.

---

## 3. Optional Visual Schema Polish

Once core Visual Schema is live in Data Query (Phase 3) and Data Requests (Phase 4), layer in the remaining VisuaLeaf ergonomics as optional incremental PRs:

1. **Group Frames (`DataRequestSpec.groups`):**
   - Reuse/adapt [`packages/case-board/src/components/frame-node.tsx`](../../../packages/case-board/src/components/frame-node.tsx) so users can draw labeled colored rectangles (`--cb-*` soft tints from `board.css`) around related tables (e.g., `"Billing"`, `"Identity"`, `"Warehouse"`).
   - Add a `Frame` tool button to `CanvasZoomDock` / `CanvasFloatingToolbar`.
2. **DBML Read-Only View / Export:**
   - Pure client-side serializer `specToDbml(spec, catalog)` producing clean DBML (`Table ... { col type [pk, not null] }`, `Ref: a.col > b.col`) with Copy & `.dbml` download inside the Export menu.
3. **Standalone Annotated HTML Export:**
   - Self-contained SVG-in-HTML snapshot export for offline design reviews (lightweight, zero external CDN dependencies).

---

## 4. Verification & Acceptance Criteria

- [ ] `apps/cli` pytest unit tests for `build_columns`, `_table_to_asset` PK/nullable metadata, and PostgreSQL / MSSQL / Oracle / ODBC / Snowflake column-level FK extraction (including multi-FK between the same table pair).
- [ ] End-to-end check against local dev stack (`classifyre-dev-stack`): re-scan a PostgreSQL source → `GET /data-query/catalog` returns `isPrimaryKey: true`, `nullable`, `rowCount`, and column-level `relations` with `constraintName` → opening Visual Schema draws exact `1`–`N` column-to-column FK edges with zero heuristics needed.
- [ ] Optional polish items ship cleanly behind existing `DataRequestSpecSchema` defaults with no regressions.
