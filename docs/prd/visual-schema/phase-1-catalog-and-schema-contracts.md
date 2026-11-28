# Phase 1 · Shared Schema & Data Query Catalog Contracts

| | |
| --- | --- |
| **Goal** | Prepare the shared spec schema (`@workspace/schemas/data-request`) and Data Query catalog API (`GET /data-query/catalog`) so the Visual Schema engine has PK/FK relations, row counts, nullability, and persisted visual metadata — with zero Prisma DB migrations |
| **Depends on** | Existing `QueryCatalogService`, `Edge` table (`relationType = 'FOREIGN_KEY'`), `packages/schemas/src/data-request.ts` |
| **Unlocks** | Phase 2 (Shared Visual Schema Engine), Phase 3 (Data Query Visual Schema), Phase 4 (Data Request Canvas Replacement) |

---

## 1. Shared Spec Schema (`packages/schemas/src/data-request.ts`)

`DataRequestSpecSchema` uses `z.strictObject(...)`, so every visual property persisted on a Data Request canvas (or exported/imported as JSON from Data Query Visual Schema) must be declared explicitly here.

### 1.1 Schema Additions (All Optional — 100% Backward Compatible)

1. **Color swatch palette constant** (aligned 1:1 with `packages/case-board/src/board.css` `--cb-*` tokens):
   ```ts
   export const SCHEMA_TABLE_COLORS = [
     "gray",
     "green",
     "amber",
     "blue",
     "violet",
     "pink",
     "yellow",
     "red",
   ] as const;
   export type SchemaTableColor = (typeof SCHEMA_TABLE_COLORS)[number];
   ```
2. **Cardinality & join origin enums:**
   ```ts
   export const DATA_REQUEST_CARDINALITIES = ["1-1", "1-N", "N-1", "N-N"] as const;
   export type DataRequestCardinality = (typeof DATA_REQUEST_CARDINALITIES)[number];

   export const DATA_REQUEST_JOIN_ORIGINS = ["manual", "fk", "inferred"] as const;
   export type DataRequestJoinOrigin = (typeof DATA_REQUEST_JOIN_ORIGINS)[number];
   ```
3. **Join types decision:**
   - Extend `DATA_REQUEST_JOIN_TYPES` from `["INNER", "LEFT"]` to `["INNER", "LEFT", "RIGHT", "FULL"]` (DuckDB supports all four natively; `generateRequestSql` already emits `${step.type} JOIN`, so `RIGHT JOIN` and `FULL JOIN` work deterministically with minimal change; keep `INNER` ↔ `LEFT` as quick-click cycle and expose `RIGHT` / `FULL` in the Properties/Relations inspector or edge menu).
4. **`DataRequestTableSchema` optional fields:**
   - `color: z.enum(SCHEMA_TABLE_COLORS).optional()` — user-selected card accent swatch (`undefined` = neutral brutalist `border-foreground`).
   - `height: z.number().finite().min(120).max(960).optional()` — persisted card body height when user resizes via `NodeResizer`.
   - `collapsed: z.boolean().optional()` — collapses column list to header bar.
   - `hidden: z.boolean().optional()` — hides card from canvas view (visual-only; SQL generation rules documented below).
5. **`DataRequestJoinSchema` optional fields:**
   - `cardinality: z.enum(DATA_REQUEST_CARDINALITIES).optional()` — ERD endpoint markers (`1` / `N`).
   - `constraintName: z.string().min(1).max(255).optional()` — declared FK name when created via Find Links / Generate.
   - `origin: z.enum(DATA_REQUEST_JOIN_ORIGINS).optional()` — `"fk"` (catalog constraint), `"inferred"` (heuristic), or `"manual"`.
6. **Visual groups (forward-compatible for Phase 5, defaulted to `[]`):**
   - `DataRequestGroupSchema = z.strictObject({ id, label, x, y, w, h, color: z.enum(SCHEMA_TABLE_COLORS).optional() })`
   - `groups: z.array(DataRequestGroupSchema).max(24).default([])` on `DataRequestSpecSchema`.

### 1.2 SQL Generation & Sketch Rules

- **`generateRequestSql(spec, lookup)`:**
  - Must ignore visual-only fields (`color`, `height`, `collapsed`, `cardinality`, `constraintName`, `origin`, `groups`).
  - **Hidden tables rule:** Hidden tables remain in `spec.tables` and continue generating SQL unless removed, **and** the UI shows a visible badge in the toolbar when any table is hidden (prevents surprising SQL diffs when a user temporarily hides a cluttering table). *(Alternative if preferred later: exclude hidden tables from SQL; we document visual-only as the safer default for Data Requests).*
  - When `RIGHT` / `FULL` joins are selected, emit `RIGHT JOIN` / `FULL OUTER JOIN` cleanly.
- **`specToSketch(spec)` ([`packages/schemas/src/data-request.ts#L760-L852`](../../../packages/schemas/src/data-request.ts#L760-L852)):**
  - Replace `const TABLE_ACCENT_HEX = "#0284c7"` with a lookup map from `SchemaTableColor` → neutral/swatch hex (defaulting to `#0a0a0a` / theme-neutral accent rather than sky blue).
  - Skip `hidden: true` tables in the thumbnail sketch so case-card thumbnails match what the user sees.

---

## 2. Data Query Catalog API (`apps/api/src/data-query/`)

Today `GET /data-query/catalog` returns `QueryCatalogDto` with only `{ name, type, access, mask, inClear }` per column and no relationships, primary keys, or row counts.

### 2.1 DTO Changes (`apps/api/src/data-query/data-query.dto.ts`)

1. **`QueryColumnDto`** — add optional schema metadata:
   ```ts
   @ApiPropertyOptional({ description: 'Part of the table primary key, when scanned.' })
   isPrimaryKey?: boolean;

   @ApiPropertyOptional({ description: 'Whether the column allows NULL values, when known.' })
   nullable?: boolean;
   ```
2. **`QueryCatalogTableDto`** — add optional table metadata:
   ```ts
   @ApiPropertyOptional({ description: 'Estimated row count from the last scan, when known.' })
   rowCount?: number;
   ```
3. **New `QueryCatalogRelationDto`** & **`QueryCatalogDto.relations`**:
   ```ts
   export class QueryCatalogRelationDto {
     @ApiProperty()
     fromAssetId: string;

     @ApiPropertyOptional({ description: 'FK column on the source table, when scanned.' })
     fromColumn?: string;

     @ApiProperty()
     toAssetId: string;

     @ApiPropertyOptional({ description: 'Referenced column on the target table, when scanned.' })
     toColumn?: string;

     @ApiPropertyOptional({ description: 'Database constraint name, when scanned.' })
     constraintName?: string;

     @ApiPropertyOptional({ enum: ['1-1', '1-N', 'N-1', 'N-N'] })
     cardinality?: '1-1' | '1-N' | 'N-1' | 'N-N';
   }
   ```
   Add `@ApiPropertyOptional({ type: [QueryCatalogRelationDto] }) relations?: QueryCatalogRelationDto[];` to `QueryCatalogDto`.

### 2.2 Service Changes (`apps/api/src/data-query/query-catalog.service.ts`)

1. **Extract `rowCount`, `primaryKeys`, `nullable` in `tables()` & `columnsOf()`:**
   - Read `row_count` (already persisted on `Asset.metadata` by `tabular_base.py:991`, Parquet/Arrow metadata in `file_metadata.py:194`) → set `rowCount` when `typeof metadata.row_count === 'number'`.
   - Read `primary_keys` (`string[]`) or `primary_key` (`string`, already set by Meilisearch and Phase 5 SQL connectors) from `asset.metadata`, plus per-column `is_primary_key` / `pk` / `nullable` if present inside `metadata.columns[]`.
   - Preserve `isPrimaryKey` and `nullable` through `columnsAsSeen()` in [`apps/api/src/data-query/column-masks.ts`](../../../apps/api/src/data-query/column-masks.ts) so governance masking keeps PK/nullable metadata on visible columns and still strips hidden columns completely.
2. **Load `FOREIGN_KEY` relations in `tables()` (cached with the 30s `CachedTables` entry):**
   - Query `this.prisma.edge.findMany`:
     ```ts
     where: {
       relationType: 'FOREIGN_KEY',
       fromType: 'asset',
       toType: 'asset',
       fromId: { in: assetIds },
       toId: { in: assetIds },
     },
     select: {
       fromId: true,
       toId: true,
       metadata: true,
       fieldMappings: true,
     }
     ```
   - Parse two shapes gracefully:
     - **Column-level FK (Phase 5 scanners):** `fieldMappings` or `metadata.columns` contains `{ fromColumn, toColumn, constraintName, cardinality }` → emit one `QueryCatalogRelationDto` per column pair (or composite FK entry).
     - **Table-level FK (existing scanned data today):** `fieldMappings` / `metadata` has no column names → emit `{ fromAssetId: edge.fromId, toAssetId: edge.toId, cardinality: 'N-1' }`. The frontend `find-links.ts` uses these real table-level FK links as high-confidence hints to pair columns immediately, even before any connector rescan!
3. **Governance filtering in `catalog()` / `publicCatalog()` (Security Critical):**
   - Filter `relations` so **both** `fromAssetId` and `toAssetId` are present in the caller's returned `sources[].tables[]` (respects `connection` scope and `seeLocked`).
   - If a relation names `fromColumn`, verify `fromColumn` exists in the caller's post-mask visible `fromTable.columns` (case-insensitive). Same for `toColumn` on `toTable.columns`.
   - If either endpoint column is hidden for this principal, **omit the relation** (or strip its hidden column names) so governance-hidden columns are never leaked through FK metadata.
4. **Update `apps/web/lib/data-query.ts`:**
   - Export `QueryCatalogRelation = QueryCatalogRelationDto`.
   - Update `catalogOfSource(catalog, sourceId)` ([`apps/web/lib/data-query.ts#L303-L311`](../../../apps/web/lib/data-query.ts#L303-L311)) so it also filters `catalog.relations` to relations where both `fromAssetId` and `toAssetId` belong to that source.

### 2.3 OpenAPI & Generated Client

- Regenerate `openapi.json` and `packages/api-client/src/generated/` via the repo's codegen script (`bun run codegen` / API OpenAPI script) so frontend TypeScript types pick up `rowCount`, `isPrimaryKey`, `nullable`, and `relations`.

---

## 3. Data Requests API Impact (`apps/api/src/data-requests/`)

- **Zero Prisma migrations:** `DataRequest.spec` is already `Json`.
- **Zero new REST routes required:** `PUT /data-requests/:id/spec` validates via `DataRequestSpecSchema` automatically.
- Verify `DataRequestChecksService.runStaticCheck` continues passing with `RIGHT` / `FULL` join SQL and optional visual fields in `spec`.

---

## 4. Verification & Acceptance Criteria

- [ ] `packages/schemas/src/data-request.ts`: unit tests (in `apps/api/src/data-requests/`) verify:
  - Existing v1 specs (without `color`, `height`, `cardinality`, `groups`) parse cleanly.
  - New visual fields parse cleanly and do not alter generated SQL.
  - `RIGHT` / `FULL` joins generate valid deterministic DuckDB SQL.
  - `specToSketch` uses neutral/swatch colors (no hardcoded `#0284c7`) and excludes `hidden` tables.
- [ ] `apps/api/src/data-query/`: unit tests verify:
  - `QueryCatalogService.publicCatalog()` returns `rowCount`, `isPrimaryKey`, `nullable`, and `relations`.
  - Relations touching a governance-hidden column are stripped for principals who cannot read in clear, and retained for owners/stewards/`data.unmask` holders.
  - Relations touching tables outside a SQL connection scope or invisible to the caller are excluded.
- [ ] `openapi.json` and `@workspace/api-client` regenerated cleanly; `tsc --noEmit` passes across `apps/api` and `apps/web`.
