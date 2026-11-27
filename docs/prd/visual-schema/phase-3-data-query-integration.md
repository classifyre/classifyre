# Phase 3 · Data Query Integration (First Product Consumer)

| | |
| --- | --- |
| **Goal** | Ship the shared Visual Schema engine inside the **Data Query** experience (`/<ws>/query` SQL IDE and `QuerySourceTab`) as our first live consumer — enabling ER diagram exploration AND visual SQL query building |
| **Depends on** | Phase 1 (Catalog `rowCount`, `primaryKeys`, `relations`), Phase 2 (Shared Visual Schema Engine) |
| **Unlocks** | Immediate user value for every SQL user + real-world validation of the engine before replacing Data Requests in Phase 4 |

---

## 1. Where Visual Schema Lives in Data Query

### Entry Point A · Source Tab Inside `/<ws>/query` (`QuerySourceTab`)

In [`apps/web/components/data-query/query-source-tab.tsx`](../../../apps/web/components/data-query/query-source-tab.tsx#L668-L740), `QuerySourceTab` already renders DBeaver-style subtabs: `Tables | Overview | Governance | Findings | Connections`.

- **Add a `Visual Schema` subtab** (icon: `Network` or `Workflow`, placed right after `Tables`):
  - Catalog scoped to that source via `catalogOfSource(catalog, source.id)`.
  - On first open, automatically runs **Generate** for the source's tables (up to a sensible auto-generate threshold, e.g., 25 tables; if a source has >25 tables, prompts the user to pick tables from the left rail or click "Place first 25" so huge schemas never overwhelm the canvas).
  - Supports **Explore ER** + **Visual Query Builder** seamlessly: users can inspect PK/FK structure, tick columns / add filters / adjust joins, and click **"Open in SQL"** to jump straight to the main SQL Query tab with generated SQL.
  - Clicking **"Open Data"** on any table card calls `onOpenTable(table, source)` to open that table's 200-row DBeaver data preview tab.

### Entry Point B · Dedicated `Visual Schema` Tab in `/<ws>/query` IDE

In [`apps/web/app/[locale]/[namespaceSlug]/(dashboard)/query/page.tsx`](../../../apps/web/app/[locale]/[namespaceSlug]/(dashboard)/query/page.tsx#L50-L60):

- Extend `DynamicTab` with a third tab kind:
  ```ts
  | { kind: "schema"; id: string; title: string; sourceId?: string }
  ```
- **How users open it:**
  1. A compact **"Visual Schema"** button in the `/query` tab strip / header (opens a workspace-wide cross-source Visual Schema tab `schema:workspace` where tables from *any* source — e.g. PostgreSQL + Delta Lake — can be dragged and joined visually!).
  2. Context action / icon button on any source row in [`query-explorer.tsx`](../../../apps/web/components/data-query/query-explorer.tsx) ("Open Visual Schema") opening `schema:<sourceId>` pre-populated with that source.
- Persist open `schema` tabs in [`apps/web/lib/query-tabs-cookie.ts`](../../../apps/web/lib/query-tabs-cookie.ts) alongside `source` and `asset` tabs.

### Entry Point C · Standalone Source Page (`/sources/:id?tab=data`)

In [`apps/web/components/data-query/source-data-tab.tsx`](../../../apps/web/components/data-query/source-data-tab.tsx), add a lightweight view toggle (`SQL | Visual Schema`) so users visiting a source's Data tab directly can also inspect its ER diagram and send visual queries into that page's `QueryWorkbench`.

---

## 2. Local Store & State (`apps/web/components/data-query/query-schema-store.ts`)

Data Query Visual Schema is **ephemeral / local-first** (no server `DataRequest` entity required):
- Vanilla Zustand store implementing `VisualSchemaAdapter` from Phase 2.
- Supports full Undo/Redo (`MAX_HISTORY = 50`), live deterministic SQL generation via `generateRequestSql(spec, buildCatalogLookup(catalog))`, and `localStorage` persistence keyed by `classifyre:query-schema:${namespaceSlug}:${scopeKey}` so card positions, colors, and zoom survive tab switches and page refreshes (mirroring VisuaLeaf's tab-state persistence).
- **Higher table cap in Explore/Query mode:** Allow up to `40` tables on the canvas for ER exploration (override `maxTables: 40`), while warning if >8 distinct sources are selected for SQL generation (`DATA_REQUEST_MAX_SOURCES = 8`).
- **Locked tables handling:** Just like Data Query's explorer (`canQuery: false`), locked tables can still be placed for schema exploration (marked with a `Lock` icon), and the SQL panel clearly flags if the current user cannot run the generated SQL directly — offering **"Request this dataset"** (creates a Data Request pre-populated with the canvas spec!).

---

## 3. Data Query Right Inspector Tabs

When mounted in Data Query (`mode: "query-builder"`), the collapsible right panel exposes 3 focused tabs:

| Tab | Contents |
| --- | --- |
| **SQL** | Read-only live preview of generated SQL (using existing `SqlEditor` in `readOnly` mode), diagnostics strip, and primary action buttons: **"Open in SQL Editor"** (`editInQuery(sql)`), **"Copy SQL"**, and **"Request as Dataset"** (navigates to `/cases/new/data-request` with the current spec handoff when any table is locked or user wants a governed shared dataset) |
| **Properties** | Shared `SchemaPropertiesPanel` (selected table alias, color swatch, row count, governance masks/row filters, columns, `WHERE` filters — or selected join type & cardinality) |
| **Relations** | Shared `SchemaRelationsPanel` (searchable joins, discovered FK suggestions with one-click `+ Add`, click-to-frame, `+ Add Relation` dialog) |

---

## 4. Files to Create / Modify in Phase 3

| File | Change |
| --- | --- |
| `apps/web/components/data-query/query-schema-store.ts` | **New** — localStorage-backed `VisualSchemaAdapter` store for Data Query |
| `apps/web/components/data-query/query-schema-tab.tsx` | **New** — mounts `VisualSchemaWorkspace` with SQL preview + "Open in SQL" + "Request as Dataset" + "Open Table Data" bridges |
| `apps/web/components/data-query/query-source-tab.tsx` | **Modify** — add `Visual Schema` subtab to `WorkbenchObjectShell` |
| `apps/web/app/[locale]/[namespaceSlug]/(dashboard)/query/page.tsx` | **Modify** — support `kind: "schema"` tab, header button, and `editInQuery` / `openAssetTab` callbacks |
| `apps/web/components/data-query/query-explorer.tsx` | **Modify** — add "Open Visual Schema" action on source rows |
| `apps/web/lib/query-tabs-cookie.ts` | **Modify** — serialize/restore `kind: "schema"` tabs safely |
| `apps/web/components/data-query/source-data-tab.tsx` | **Modify** — optional `SQL | Visual Schema` switcher on Source → Data page |
| `apps/web/i18n/en.json` & `apps/web/i18n/de.json` | **Modify** — add `visualSchema.*` and `dataQuery.schema.*` keys |

---

## 5. Verification & Acceptance Criteria

- [ ] Opening `/query` → clicking a Source tab → switching to **Visual Schema** auto-renders the source's tables with ELK layout and detected FK/inferred edges.
- [ ] Opening workspace-wide **Visual Schema** in `/query` allows dragging tables from two different sources (e.g. Postgres + Delta), connecting columns, ticking columns, adding a `WHERE` filter, and clicking **"Open in SQL"** — switching to the SQL tab with valid formatted DuckDB SQL ready to run.
- [ ] Clicking **"Open Table Data"** on a table card opens its `QueryAssetTab`.
- [ ] Locked tables display their governance lock badge and masked columns display `ColumnAccessChip`; hidden columns never appear.
- [ ] Unit tests for `query-schema-store.ts` + Playwright CT test for `QuerySchemaTab` + `test:i18n` pass.
