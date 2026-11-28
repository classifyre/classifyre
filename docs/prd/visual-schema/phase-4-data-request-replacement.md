# Phase 4 · Data Request Canvas Replacement & Color Token Cleanup

| | |
| --- | --- |
| **Goal** | Replace the current ad-hoc Data Request canvas with the shared `VisualSchemaWorkspace` engine, add `Properties` & `Relations` tabs to `RequestSqlPanel`, and **eliminate every hardcoded `sky-*` / `#0284c7` / `#0369a1` blue** across the Data Request module |
| **Depends on** | Phase 1 (`DataRequestSpec` schema extensions), Phase 2 (Shared Visual Schema Engine), Phase 3 (field-tested in Data Query) |
| **Unlocks** | Unified, high-contrast brutalist schema experience across the entire product |

---

## 1. Replacing the Data Request Canvas with the Shared Engine

### 1.1 Store Adapter (`apps/web/components/data-request/store/request-store.ts`)

Extend `createRequestStore` with the visual-schema mutations needed by `VisualSchemaAdapter` — all still funneling through `commitSpec()` (so Undo/Redo, debounced `PUT /data-requests/:id/spec`, optimistic `specVersion` conflict handling, and static `check` work automatically):

- `addTables(tables, positions?)` — bulk-add for multi-drag and per-source **Generate**, respecting `DATA_REQUEST_MAX_TABLES = 12` (with toast warning if capped).
- `removeTables(tableIds)` — bulk-remove for multi-select `Delete` / ContextMenu.
- `moveTables(updates: Record<string, { x; y }>)` — single undo step when dragging multi-selected tables or applying ELK/Grid layout!
- `setTableColor(tableIds, color | undefined)` — updates `table.color`.
- `resizeTable(tableId, height)` — updates `table.height`.
- `toggleTableCollapsed(tableId)` — toggles `table.collapsed`.
- `setTablesHidden(tableIds, hidden)` — updates `table.hidden`.
- `renameTableAlias(tableId, alias)` — validates `PLAIN_IDENT` + uniqueness before committing.
- `updateJoin(joinId, patch: { type?, cardinality?, constraintName?, origin? })` — updates join type (`INNER`/`LEFT`/`RIGHT`/`FULL`) and cardinality.
- `removeTableJoins(tableIds)` — removes all joins incident to the given tables.
- `findLinks(tableIds?)` — runs `lib/find-links.ts` against `catalog` and commits new joins in one undo step.
- `clearCanvas()` — clears `tables` and `joins` (preserving unanchored comment pins or prompting clearly).
- `importSpec(nextSpec)` — validates & replaces `tables`/`joins` while preserving server-managed `pins`!

### 1.2 Preserving All Data Request-Specific Features

Through `VisualSchemaWorkspace` extension slots, every existing Data Request capability stays intact:
- **Comment Pins (`RequestCommentPin`):** Passed via `extraNodes` + `extraNodeTypes` (`"request-comment"`). Clicking a table/column comment icon or toggling the Comment Pin tool opens `CommentComposerPopover` and persists via `POST /data-requests/:id/comments` exactly as today.
- **Live Sync & Presence:** `useCaseRoomSocket` in `DataRequestWorkspace` continues updating `PresenceChips` and reloading on remote edits.
- **Permissions (`canEditSpec`, `canEditSql`, `canPreview`, `canComment`):** Read-only states (`DELIVERED`, `DECLINED`, `WITHDRAWN`, or viewers) cleanly disable drag/resize/context-menu edits while still allowing pan, zoom, minimap, search, Properties/Relations inspection, and diagram export!
- **Top-Left Status Slot:** Undo/Redo, Comment Pin tool toggle, and `saving` / `unsaved` / `saved` indicator stay accessible in `topLeftSlot`.
- **Filters:** `FilterPopover` mounts inside `SchemaTableNode`'s header action slot and inside the `Properties` tab.

### 1.3 Upgrading `RequestSqlPanel` (`apps/web/components/data-request/request-sql-panel.tsx`)

- Add **`Properties`** and **`Relations`** tabs alongside existing **`SQL`**, **`Checks`**, **`Preview`** (team-only), and **`History`**:
  - Tab order: `SQL` | `Properties` | `Relations` | `Checks` | `Preview` | `History` (compact icon+label triggers that fit cleanly inside the collapsible right panel).
  - Selecting a table or join on the canvas highlights it and lets the user switch to `Properties` to edit alias, color, filters, join type, or cardinality.
  - Clicking an entry in `Relations` calls `fitView` on the two connected tables on the canvas.
- Keep `sqlEdited` amber warning banner, Monaco `SqlEditor`, `regenerateSqlFromCanvas` dialog, `runDescribe` button, `ResultsGrid` preview, and delivery history unchanged in behavior.

---

## 2. Complete Audit & Removal of Ad-Hoc `sky-*` / `#0284c7` Blues

Every non-standard blue currently in the Data Request module will be replaced with Classifyre's brutalist tokens from [`packages/ui/src/styles/globals.css`](../../../packages/ui/src/styles/globals.css) and [`packages/case-board/src/board.css`](../../../packages/case-board/src/board.css):

| File | Current Hardcoded Blue | Replacement (Classifyre Token) |
| --- | --- | --- |
| [`packages/schemas/src/data-request.ts#L765`](../../../packages/schemas/src/data-request.ts#L765) | `const TABLE_ACCENT_HEX = "#0284c7"` | Swatch lookup table defaulting to `#0a0a0a` (neutral ink) or `--cb-*` hex matching `table.color` |
| [`apps/web/components/data-request/request-top-bar.tsx`](../../../packages/web/components/data-request/request-top-bar.tsx) | Kind badge (`border-sky-500/40 bg-sky-500/10 text-sky-700`), stepper line (`bg-sky-500`), active step (`bg-sky-500/15 text-sky-700`), Publish Now sparkle (`text-sky-600`) | Kind badge: `border-border bg-muted text-foreground`; active step: `bg-accent text-accent-foreground font-semibold` (or `bg-foreground text-background`), stepper line: `bg-foreground`; sparkle: `text-[var(--accent-ink)]` |
| [`apps/web/components/data-request/new-data-request-form.tsx`](../../../packages/web/components/data-request/new-data-request-form.tsx) | `border-t-2 border-t-sky-500`, `text-sky-600 dark:text-sky-400` | `border-t-2 border-t-foreground` (or `.panel-card`), `text-foreground` / `text-[var(--accent-ink)]` |
| [`apps/web/components/data-request/request-catalog-rail.tsx`](../../../packages/web/components/data-request/request-catalog-rail.tsx) | Replaced by shared `SchemaCatalogRail` (`text-sky-600`, `bg-sky-500/5`, `hover:bg-sky-500/15`) | `text-foreground` icons, placed `Check` in `text-[var(--accent-ink)]`, selected row `border-foreground bg-muted`, hover `hover:bg-accent hover:text-accent-foreground` |
| [`apps/web/components/data-request/request-canvas.tsx`](../../../packages/web/components/data-request/request-canvas.tsx) | Replaced by shared `VisualSchemaCanvas` (`border-sky-500/40`, `text-sky-600`, `bg-sky-500/15`) | Empty hint: `border-dashed border-border bg-card`; anchor chip: `bg-muted border border-border text-foreground` |
| [`apps/web/components/data-request/nodes/table-node.tsx`](../../../packages/web/components/data-request/nodes/table-node.tsx) | Replaced by shared `SchemaTableNode` (`border-t-sky-500`, `ring-sky-500/60`, `bg-sky-500/15`, `!border-sky-600`, `!bg-sky-500`) | Default `border-t-foreground` (or `--cb-*` swatch), selected `ring-2 ring-[var(--cb-select)]`, joined row `bg-[color-mix(in_oklab,var(--cb-select)_12%,transparent)]`, handle fill `var(--cb-select)` |
| [`apps/web/components/data-request/edges/join-edge.tsx`](../../../packages/web/components/data-request/edges/join-edge.tsx) | Replaced by shared `SchemaRelationEdge` (`#0284c7`, `#0369a1`, `border-sky-500/60`, `ring-sky-500`) | Stroke `var(--cb-edge)` / selected `var(--cb-select)`, badge `border-border bg-card text-foreground` |
| [`apps/web/components/data-request/nodes/filter-popover.tsx`](../../../packages/web/components/data-request/nodes/filter-popover.tsx) | Active filter pill (`bg-sky-500/15 text-sky-700`), operator text (`text-sky-600`) | Active filter pill: `bg-accent text-accent-foreground` (high contrast in both modes); operator text: `text-[var(--accent-ink)] font-semibold` |
| [`apps/web/components/data-request/request-sql-panel.tsx`](../../../packages/web/components/data-request/request-sql-panel.tsx) | Links (`text-sky-600 hover:underline dark:text-sky-400`) | `text-foreground underline underline-offset-2 hover:text-[var(--accent-ink)]` |

**Regression check:** After Phase 4, running:
```bash
rg "sky-|#0284c7|#0369a1" apps/web/components/data-request apps/web/components/visual-schema packages/schemas/src/data-request.ts
```
must return **zero matches**.

---

## 3. Data Query → Data Request Handoff

Wire the **"Request as Dataset"** button from Phase 3 (`QuerySchemaTab`) into [`apps/web/components/data-request/new-data-request-form.tsx`](../../../apps/web/components/data-request/new-data-request-form.tsx):
- Store the handoff `DataRequestSpec` briefly in `sessionStorage` (keyed by a short token in `?draft=<token>` so large specs never blow URL limits).
- `NewDataRequestForm` reads it, displays a compact preview chip (`N tables, M joins preloaded from Visual Schema`), and submits it in `CreateDataRequestDto.spec` (already supported by [`DataRequestsService.create`](../../../apps/api/src/data-requests/data-requests.service.ts#L447-L483)!).

---

## 4. Verification & Acceptance Criteria

- [ ] `rg "sky-|#0284c7|#0369a1" apps/web/components/data-request apps/web/components/visual-schema packages/schemas/src/data-request.ts` returns 0 matches.
- [ ] All existing tests in [`request-store.spec.ts`](../../../apps/web/components/data-request/store/request-store.spec.ts), [`data-request-canvas.spec.tsx`](../../../apps/web/tests/components/data-request-canvas.spec.tsx), and [`spec-to-sketch.spec.ts`](../../../apps/web/lib/spec-to-sketch.spec.ts) pass (updated for new visual actions & test IDs where needed).
- [ ] Existing saved `DataRequest` cases open, edit, save, check, describe, comment, and deliver with zero regressions.
- [ ] New Playwright CT tests cover: multi-select drag, ELK Auto-Arrange, Find Links, context menu color change, Properties & Relations tabs, and Export JSON round-trip inside `DataRequestWorkspaceView`.
- [ ] Light and dark mode visual check confirms crisp brutalist contrast on every control and badge.
