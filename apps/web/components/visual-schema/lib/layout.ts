import type {
  DataRequestJoin,
  DataRequestTable,
} from "@workspace/schemas/data-request";
import { layeredLayout } from "@workspace/schemas/case-board";
import type { QueryCatalog } from "@/lib/data-query";
import { SCHEMA_TABLE_WIDTH, snapSchemaCoord } from "../types";

const GRID_HORIZONTAL_GAP = 56;
const GRID_VERTICAL_GAP = 60;
const CARD_HEADER_HEIGHT = 88;
const CARD_ROW_HEIGHT = 26;
const CARD_COLLAPSED_HEIGHT = 68;
const DEFAULT_MAX_CARD_HEIGHT = 320;

export function estimateTableCardHeight(
  table: DataRequestTable,
  columnCount?: number,
): number {
  if (table.collapsed) return CARD_COLLAPSED_HEIGHT;
  if (typeof table.height === "number" && Number.isFinite(table.height)) {
    return table.height + 64;
  }
  const count = columnCount ?? Math.max(3, table.keep.length);
  return Math.min(DEFAULT_MAX_CARD_HEIGHT, CARD_HEADER_HEIGHT + count * CARD_ROW_HEIGHT);
}

function columnCountMap(catalog: QueryCatalog | null): Map<string, number> {
  const map = new Map<string, number>();
  for (const src of catalog?.sources ?? []) {
    for (const tbl of src.tables) {
      map.set(tbl.assetId, tbl.columns.length);
    }
  }
  return map;
}

/**
 * Arrange visible tables into connected components using the shared ELK Web Worker
 * (falling back automatically to layeredLayout when ELK times out or in Node/Jest).
 */
export async function layoutConnectedGroups(
  tables: readonly DataRequestTable[],
  joins: readonly DataRequestJoin[],
  catalog: QueryCatalog | null = null,
): Promise<Record<string, { x: number; y: number }>> {
  const visible = tables.filter((t) => !t.hidden);
  if (visible.length === 0) return {};

  const counts = columnCountMap(catalog);
  const visibleIds = new Set(visible.map((t) => t.id));
  const layoutNodes = visible.map((t) => ({
    id: t.id,
    width: SCHEMA_TABLE_WIDTH,
    height: estimateTableCardHeight(t, counts.get(t.assetId)),
  }));
  const layoutEdges = joins
    .filter(
      (j) =>
        visibleIds.has(j.left.tableId) &&
        visibleIds.has(j.right.tableId) &&
        j.left.tableId !== j.right.tableId,
    )
    .map((j) => ({
      id: j.id,
      source: j.left.tableId,
      target: j.right.tableId,
    }));

  let positions: Map<string, { x: number; y: number }>;
  if (typeof window !== "undefined" && typeof Worker !== "undefined") {
    const { elkLayout } = await import(
      "@/components/case-board/hooks/elk-layout"
    );
    positions = await elkLayout(layoutNodes, layoutEdges, { x: 40, y: 40 });
  } else {
    positions = layeredLayout(layoutNodes, layoutEdges, { x: 40, y: 40 });
  }
  const out: Record<string, { x: number; y: number }> = {};
  for (const t of visible) {
    const pos = positions.get(t.id);
    if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
      out[t.id] = {
        x: snapSchemaCoord(pos.x),
        y: snapSchemaCoord(pos.y),
      };
    }
  }
  return out;
}

/**
 * Deterministic grid arrangement sorted by sqlName with row-height packing
 * and zero overlapping bounding boxes.
 */
export function layoutGrid(
  tables: readonly DataRequestTable[],
  catalog: QueryCatalog | null = null,
  columnsPerRow?: number,
): Record<string, { x: number; y: number }> {
  const visible = tables
    .filter((t) => !t.hidden)
    .slice()
    .sort((a, b) => a.sqlName.localeCompare(b.sqlName));
  if (visible.length === 0) return {};

  const counts = columnCountMap(catalog);
  const cols =
    columnsPerRow ??
    (visible.length <= 2 ? visible.length : visible.length <= 9 ? 3 : 4);
  const colStep = snapSchemaCoord(SCHEMA_TABLE_WIDTH + GRID_HORIZONTAL_GAP);

  const out: Record<string, { x: number; y: number }> = {};
  let y = 40;
  for (let rowStart = 0; rowStart < visible.length; rowStart += cols) {
    const row = visible.slice(rowStart, rowStart + cols);
    let maxRowHeight = 0;
    row.forEach((tbl, colIdx) => {
      const h = estimateTableCardHeight(tbl, counts.get(tbl.assetId));
      maxRowHeight = Math.max(maxRowHeight, h);
      out[tbl.id] = {
        x: snapSchemaCoord(40 + colIdx * colStep),
        y: snapSchemaCoord(y),
      };
    });
    y += snapSchemaCoord(maxRowHeight + GRID_VERTICAL_GAP);
  }
  return out;
}
