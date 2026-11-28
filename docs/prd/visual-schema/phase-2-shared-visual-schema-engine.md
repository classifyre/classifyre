# Phase 2 · Shared Visual Schema Engine (`@xyflow/react`)

| | |
| --- | --- |
| **Goal** | Build a reusable, theme-native Visual Schema canvas engine under `apps/web/components/visual-schema/` that implements VisuaLeaf's interactive ER & Schema Designer UX on top of `@xyflow/react`, `elkjs`, `html-to-image`, and `@workspace/ui` |
| **Depends on** | Phase 1 (`QueryCatalogDto.relations`, `isPrimaryKey`, `nullable`, `rowCount`, updated `DataRequestSpec`) |
| **Unlocks** | Phase 3 (Data Query Visual Schema tab) & Phase 4 (Data Request canvas replacement) |

---

## 1. Directory Structure

```text
apps/web/components/visual-schema/
├── visual-schema.css               # Scoped .visual-schema React Flow --xy-* token overrides
├── types.ts                        # VisualSchemaAdapter, SchemaMode, Node/Edge data types, swatch map
├── visual-schema-workspace.tsx     # 3-pane collapsible shell (Left Rail | Canvas | Right Inspector)
├── visual-schema-canvas.tsx        # Core <ReactFlow> canvas: LOD, Pan/Select, MiniMap, shortcuts
├── schema-catalog-rail.tsx         # Left rail: search, placed ✓, multi-select drag, Generate
├── canvas-floating-toolbar.tsx     # Top-right floating toolbar (Hidden, Arrange, Find Links, Grid, Clear, Export)
├── canvas-zoom-dock.tsx            # Bottom-left vertical dock (+, -, Fit, Pan, Select, Minimap, %)
├── nodes/
│   ├── schema-table-node.tsx       # Table card with LOD, PK/FK, nullable, NodeResizer, ContextMenu
│   └── table-color-swatches.tsx    # Shared --cb-* swatch picker (used in ContextMenu + Properties)
├── edges/
│   └── schema-relation-edge.tsx    # Orthogonal step path + 1/N cardinality badges + join toggle
├── panels/
│   ├── schema-properties-panel.tsx # Selected table / edge inspector (alias, color, columns, filters, cardinality)
│   └── schema-relations-panel.tsx  # Filterable relations list, FK suggestions, click-to-frame, + Add Join
└── lib/
    ├── layout.ts                   # ELK Connected Groups (reusing elk-layout.ts worker) + Grid layout
    ├── find-links.ts               # Catalog FK matcher + naming/type heuristic fallback
    └── export-diagram.ts           # PNG (1x/2x/B&W), SVG (html-to-image), Spec JSON export/import
```

---

## 2. Adapter Contract (`types.ts`)

So the exact same engine serves **Data Query** (local/session state) and **Data Request** (server-synced `RequestStore` with comments, locks, and optimistic concurrency), all mutations flow through a narrow `VisualSchemaAdapter`:

```ts
export type VisualSchemaMode = "explore" | "query-builder" | "data-request";

export interface VisualSchemaCapabilities {
  canEdit: boolean;              // Drag, add/remove tables, connect joins, edit filters/colors
  showColumnSelection: boolean;  // Show SELECT checkboxes (true in query-builder & data-request)
  showFilters: boolean;          // Show FilterPopover button on table header
  showComments: boolean;         // Show comment pin triggers & render extra pin nodes
  maxTables: number | null;      // e.g. 12 for data-request; higher/null for explore ER
}
```

The adapter provides:
- **State:** `spec: DataRequestSpec`, `catalog: QueryCatalog | null`, `diagnostics: RequestSqlDiagnostic[]`, `saving?: boolean`, `dirty?: boolean`, `canUndo: boolean`, `canRedo: boolean`.
- **Mutations:** `addTables`, `removeTables`, `moveTables`, `resizeTable`, `setTableColor`, `toggleTableCollapsed`, `setTablesHidden`, `renameAlias`, `toggleColumn`, `setTableColumns`, `addFilter`, `removeFilter`, `addJoin`, `updateJoin`, `removeJoin`, `removeTableJoins`, `applyLayout`, `clearCanvas`, `importSpec`, `undo`, `redo`.
- **Extension slots (for consumers):**
  - `extraNodes?: Node[]` (e.g., `RequestCommentPinNode` in Data Requests)
  - `extraNodeTypes?: NodeTypes`
  - `topLeftSlot?: React.ReactNode` (e.g., Undo/Redo + Comment Pin tool + Save status)
  - `rightTabs?: Array<{ value: string; label: string; icon?: React.ReactNode; badge?: React.ReactNode; content: React.ReactNode }>` (Data Request appends `SQL`, `Checks`, `Preview`, `History`; Data Query appends `SQL` preview + `Open in SQL` action)
  - `onTableHeaderAction?: ...` / `onInspectTableData?: (table: QueryCatalogTable) => void` (lets Data Query open a table's Data tab directly from a card!).

---

## 3. Component Specifications

### 3.1 Scoped Styling (`visual-schema.css`)

Mirrors [`packages/case-board/src/board.css`](../../../packages/case-board/src/board.css#L78-L119) using Classifyre's tokens:
- `.visual-schema .react-flow`:
  - `--xy-background-color: var(--background)`
  - `--xy-background-pattern-color: color-mix(in oklab, var(--foreground) 18%, transparent)`
  - `--xy-edge-stroke: var(--cb-edge)`
  - `--xy-edge-stroke-selected: var(--cb-select)`
  - `--xy-connectionline-stroke: var(--foreground)`
  - `--xy-connectionline-stroke-width: 2`
  - `--xy-selection-background-color: color-mix(in oklab, var(--accent) 16%, transparent)`
  - `--xy-selection-border: 1px dashed var(--foreground)`
  - `--xy-minimap-background-color: var(--card)`
  - `--xy-minimap-mask-background-color: color-mix(in oklab, var(--background) 72%, transparent)`
- Dimming class `.visual-schema .react-flow__node.vs-dim, .visual-schema .react-flow__edge.vs-dim { opacity: 0.2; transition: opacity 0.15s; }` (disabled under `prefers-reduced-motion`).
- Pan vs Select cursor rules matching `.tool-hand` in `board.css`.

### 3.2 `SchemaTableNode` (`nodes/schema-table-node.tsx`)

1. **Semantic Zoom (LOD):**
   - Subscribe to compact boolean via `useStore((s) => s.transform[2] < 0.45)` (boolean selector avoids re-rendering on every zoom tick!).
   - **Compact LOD (`zoom < 0.45`):** Renders a crisp brutalist block (`min-h-[64px]`) showing the color accent bar (`border-l-4`), large legible table leaf name, alias chip, and status icon (lock / error). Matches VisuaLeaf's zoomed-out ER overview so 15–30 tables remain scannable.
   - **Full LOD (`zoom >= 0.45`):** Full schema table card.
2. **Card Anatomy (Full LOD):**
   - Container: `w-[268px] rounded-xs border border-border bg-card text-card-foreground` with `border-t-[3px]` driven by the table's `--cb-*` color swatch (default: `border-t-foreground`), and `ring-2 ring-[var(--cb-select)]` when selected (or `border-destructive border-t-destructive` on diagnostic error).
   - **Header:**
     - Collapse chevron, table leaf name (`font-mono text-xs font-semibold`), alias pill (`bg-muted text-foreground border border-border/40`), lock (`Lock`, `--cb-amber`) or missing (`AlertTriangle`, `--destructive`) indicator, optional row count (`~12.4k`), and hover/action icons:
       - `FilterPopover` (when `showFilters`)
       - Pin comment button (when `showComments`)
       - Quick "Open data" button (in Data Query mode)
       - Remove `X` button (when `canEdit`)
     - Subtitle: `source.schema` in `font-mono text-[10px] text-muted-foreground`.
   - **Column toolbar (when `showColumnSelection && canEdit && !collapsed`):**
     - `kept/total` counter + `Select all` / `Select none` button in `text-[var(--accent-ink)]`.
   - **Column rows (`overflow-y-auto`, height controlled by `table.height ?? 260`):**
     - Left & right per-column `<Handle>` (`col:l:<name>` / `col:r:<name>`): subtle dot that enlarges on hover/connect and fills with `var(--cb-select)` when joined.
     - Optional `Checkbox` (when `showColumnSelection`).
     - Key icon slot: `KeyRound` (`text-[var(--cb-amber)]`) for `isPrimaryKey`, `Link2` (`text-[var(--cb-violet)]`) for FK column.
     - Column name (`font-mono text-[11px]`, dimmed if unchecked in query-builder/request mode).
     - `ColumnAccessChip` when masked/restricted.
     - Right-aligned compact type (`font-mono text-[9px] uppercase text-muted-foreground`) + `?` suffix when `nullable === true`.
   - **Bottom-edge resize:** `@xyflow/react` `<NodeResizer>` (`minHeight={140}`, `maxHeight={800}`, height-only bottom handle, styled unobtrusively on hover/select) that commits `resizeTable(table.id, height)` on resize end.
3. **Right-Click Context Menu (`@workspace/ui/components/context-menu`):**
   - Works on single card OR all currently multi-selected cards:
     - **Color** submenu (8 `--cb-*` swatches + Reset to default)
     - **Find Links** (auto-create FK/inferred joins for selected table(s))
     - **Remove Links** (remove all joins connected to selected table(s))
     - **Select All Columns** / **Deselect All Columns** (when `showColumnSelection`)
     - **Collapse / Expand**
     - **Hide from Canvas**
     - **Open Table Data** (Data Query mode) / **Pin Comment** (Data Request mode)
     - **Remove from Canvas** (`destructive`)

### 3.3 `SchemaRelationEdge` (`edges/schema-relation-edge.tsx`)

1. **Path:** `getSmoothStepPath({ borderRadius: 6, offset: 24 })`.
2. **Stroke Styling (Token-Driven):**
   - Normal: `var(--cb-edge)`, `strokeWidth: 1.5`.
   - Selected or incident to a selected table: `var(--cb-select)`, `strokeWidth: 2.25`.
   - `LEFT` / `RIGHT` / `FULL` join: `strokeDasharray: "5 4"`.
   - Inferred (non-FK) join in explore mode: `strokeDasharray: "2 3"`.
3. **Endpoint Cardinality Markers (`1` / `N`):**
   - Parse `join.cardinality` (default `"1-N"` or `"N-1"` based on FK direction, omitted if unset) into `[leftCard, rightCard]`.
   - Render crisp SVG `<text>` badges offset `14px` outside `sourceX/sourceY` and `targetX/targetY` along the handle direction (`Position.Left` / `Position.Right`), using `fill: var(--foreground)` with a subtle background halo (`cb-halo`) so `1` and `N` stay legible over grid lines.
4. **Midpoint Interactive Badge (`EdgeLabel`):**
   - Brutalist pill (`rounded-xs border border-border bg-card px-1.5 py-0.5 font-mono text-[10px]`):
     - Join type button (`INNER` / `LEFT` / `RIGHT` / `FULL`) — click cycles `INNER` ↔ `LEFT` when editable.
     - Column pair `leftCol = rightCol` (or `constraintName` on hover tooltip).
     - Remove `X` button when editable.
   - At low zoom (`< 0.45`), hide the verbose midpoint pill unless the edge is selected or hovered, keeping zoomed-out ER diagrams clean.

### 3.4 `CanvasZoomDock` (`canvas-zoom-dock.tsx`, Bottom-Left)

Vertical brutalist dock (`flex-col rounded-[6px] border-2 border-border bg-card p-1`, matching `ZoomControls` & `ToolDock`):
- **Zoom In (`+`)** — `rf.zoomIn({ duration })`
- **Zoom Out (`-`)** — `rf.zoomOut({ duration })`
- **Fit View** (`Shift+1`) — `rf.fitView({ padding: 0.2, duration })`
- **Pan Mode (`Hand`, `P`)** — toggles `interactionMode = "pan"` (active state: `bg-foreground text-background`)
- **Select Mode (`BoxSelect`, `S`)** — toggles `interactionMode = "select"` (marquee rectangle selection)
- **Minimap Toggle (`Map`)** — toggles bottom-right `<MiniMap />`
- **Zoom `%` Button** — shows live `Math.round(zoom * 100)%`, click resets to `100%` (`rf.zoomTo(1, { duration })`)

### 3.5 `CanvasFloatingToolbar` (`canvas-floating-toolbar.tsx`, Top-Right)

Horizontal brutalist floating toolbar (`rounded-[6px] border-2 border-border bg-card p-1`):
1. **Hidden Tables Toggle (`Eye` / `EyeOff`)** — shows count badge when tables are hidden; toggles visibility of hidden tables (shown with dashed border & 50% opacity when revealed) or unhides all.
2. **Grid Toggle (`Grid3x3`)** — toggles `<Background />` grid lines on/off.
3. **Auto-Arrange Dropdown (`LayoutGrid` / `Network`):**
   - **Connected Groups (ELK)** — runs `layoutConnectedGroups()` via Web Worker (`elk-layout.ts`), clustering connected components with minimal edge crossings and snapping to `GRID_SNAP = 20`.
   - **Grid Layout** — arranges cards in a tidy grid sorted alphabetically (or by source).
4. **Find Links (`Sparkles` / `Link2`)** — runs `findLinks()` across all placed tables, creating non-duplicate joins from catalog FKs first, then high-confidence naming heuristics, with a toast reporting how many links were added.
5. **Clear Canvas (`Trash2` + table count badge)** — opens `AlertDialog` confirmation before clearing (when `canEdit`).
6. **Export / Import Dropdown (`Download`):**
   - **Export PNG (1×)**
   - **Export PNG (2× Retina)**
   - **Export B&W PNG (Print)** — applies grayscale/high-contrast filter during capture
   - **Export SVG**
   - **Export Spec JSON** — downloads `{ version: 1, spec }`
   - **Import Spec JSON** — validates through `DataRequestSpecSchema` before loading (when `canEdit`)

### 3.6 `SchemaCatalogRail` (`schema-catalog-rail.tsx`, Left Pane)

- Header with title, **Refresh** button (optional), and **Collapse rail** button.
- Search box filtering by source name, schema, table name, or column name.
- Source accordion groups with:
  - `SourceIcon` + source name + table count
  - **"Generate / Add all"** icon button (`Wand2` / `PlusCircle`) — adds all queryable/visible tables of that source (capped at `maxTables` with clear toast if truncated), runs `findLinks()`, and runs ELK Connected Groups layout in one click!
- Table rows:
  - `Cmd/Ctrl+Click` toggles multi-selection (highlighted with `border-foreground bg-muted`).
  - Dragging a selected table drags **all selected tables** (`application/x-classifyre-schema-tables` JSON payload `{ assetIds: string[] }`).
  - Placed tables show a crisp `Check` icon in `text-[var(--accent-ink)]` (replacing the old `bg-sky-500/5`).
  - Expandable column preview with PK/FK icons, types, and `ColumnAccessChip`.
- Footer strip: `{total} tables` + `{selectedCount} selected` + `Cmd/Ctrl+Click to select multiple` hint.

### 3.7 Right Inspector Panels (`panels/`)

1. **`SchemaPropertiesPanel` (`schema-properties-panel.tsx`):**
   - **When a table is selected:**
     - Table SQL name, source/schema, estimated `rowCount`, lock/row-filter governance notice.
     - Editable **Alias** input (validates against `PLAIN_IDENT` + uniqueness).
     - **Card Color** swatch picker (`TableColorSwatches`).
     - Column table (keep checkbox, PK/FK badge, name, type, nullable, `ColumnAccessChip`).
     - Active `WHERE` filters list + quick add (reusing `FilterPopover` logic).
   - **When a join edge is selected:**
     - Source `table.column` ↔ Target `table.column`.
     - **Join Type** selector (`INNER`, `LEFT`, `RIGHT`, `FULL`).
     - **Cardinality** selector (`1-1`, `1-N`, `N-1`, `N-N`).
     - Origin badge (`Declared FK` / `Inferred` / `Manual`) + constraint name if known.
     - Delete join button.
   - **When nothing is selected:** Canvas summary (tables count, joins count, sources count, quick "Find Links" & "Auto-Arrange" buttons).
2. **`SchemaRelationsPanel` (`schema-relations-panel.tsx`):**
   - Search/filter input (`Filter relations...`) + total count badge.
   - **Active Joins section:** Each row shows `leftAlias.col` → `rightAlias.col`, join type badge, cardinality badge (`1-N`), and warning icon if either table is missing/hidden. Clicking a row selects the edge and **frames both tables** (`fitView({ nodes: [leftNode, rightNode], padding: 0.35, duration })`).
   - **Suggested FKs section** (discovered via `findLinks` preview but not yet added): one-click **`+ Add`** button per suggestion, or **"Add all"**.
   - **`+ Add Relation` button:** opens a compact `Dialog` to pick Left Table, Left Column, Right Table, Right Column, Join Type, and Cardinality manually without dragging handles.

### 3.8 Layout, Find Links & Export Libraries (`lib/`)

- **`lib/layout.ts`:**
  - `layoutConnectedGroups(tables, joins)`: estimates each card's height (`table.height ?? Math.min(300, 88 + visibleCols * 26)`), calls `elkLayout()` from [`apps/web/components/case-board/hooks/elk-layout.ts`](../../../apps/web/components/case-board/hooks/elk-layout.ts), snaps results to `GRID_SNAP = 20`.
  - `layoutGrid(tables)`: deterministic 3-column or 4-column grid with consistent horizontal/vertical gutters (`x += 320`, row height = max card height in row + `60`).
- **`lib/find-links.ts`:**
  - **Tier 1 (Exact catalog FKs):** Matches `catalog.relations` where both `fromAssetId` and `toAssetId` are on the canvas and `fromColumn`/`toColumn` are present → `origin: "fk"`, `cardinality: rel.cardinality ?? "N-1"`, `constraintName: rel.constraintName`.
  - **Tier 2 (Table-level catalog FKs — works immediately with current scans!):** Matches `catalog.relations` where `fromColumn`/`toColumn` are absent, and resolves the column pair between those two specific tables using PK + `<target_singular>_id` / `<target>_id` / matching `*_id` column names → `origin: "fk"`, `cardinality: "N-1"`.
  - **Tier 3 (Heuristic inference — for lakehouse/CSV/NoSQL without FKs):** Detects `<table_singular>_id` → `target.id` (or target's single PK) with compatible column types → `origin: "inferred"`, `cardinality: "N-1"`.
  - Never duplicates an existing join between the same column pair.
- **`lib/export-diagram.ts`:**
  - Uses `html-to-image` (`toPng`, `toSvg`) targeting `.react-flow__viewport` with computed bounding box of all visible nodes (`getNodesBounds` + `getViewportForBounds` from `@xyflow/react`), explicit theme background fill (`getComputedStyle` `--background`), optional B&W CSS filter for print export.

---

## 4. Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `P` | Pan mode |
| `S` | Marquee Select mode |
| `Cmd/Ctrl + A` | Select all visible tables |
| `Delete` / `Backspace` | Remove selected tables or selected join (when editable & not in an input) |
| `Cmd/Ctrl + Z` / `Shift + Cmd/Ctrl + Z` | Undo / Redo |
| `Shift + 1` | Fit all tables to viewport |
| `Shift + 2` | Zoom to selected table(s) |
| `Escape` | Clear selection / exit comment pin tool |

---

## 5. Verification & Acceptance Criteria

- [ ] Unit tests for `lib/find-links.ts` (Tier 1 exact FK, Tier 2 table-level FK + column match, Tier 3 heuristic, duplicate avoidance, self-join skip).
- [ ] Unit tests for `lib/layout.ts` (Connected Groups + Grid return finite grid-snapped coordinates with zero overlap).
- [ ] Playwright CT harness verifying:
  - Semantic zoom switches `SchemaTableNode` between compact and full views at `0.45` threshold.
  - Pan (`P`) vs Select (`S`) dock switches React Flow mode cleanly.
  - Right-click `ContextMenu` changes card color swatch, runs Find Links, and removes links.
  - `MiniMap` toggles on/off and renders without layout shifts.
  - Dark & light themes have zero hardcoded `sky-*` / `#0284c7` styles and pass contrast checks.
