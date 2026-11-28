import type {
  DataRequestJoin,
  DataRequestTable,
} from "@workspace/schemas/data-request";
import { SCHEMA_TABLE_WIDTH, VISUAL_SCHEMA_GRID_SNAP } from "../types";
import {
  estimateTableCardHeight,
  layoutConnectedGroups,
  layoutGrid,
} from "./layout";

function makeTable(
  id: string,
  sqlName: string,
  overrides: Partial<DataRequestTable> = {},
): DataRequestTable {
  return {
    id,
    assetId: `a-${id}`,
    sqlName,
    alias: id,
    x: 0,
    y: 0,
    keep: ["id", "name", "email"],
    filters: [],
    ...overrides,
  };
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

describe("visual-schema layout", () => {
  const tables: DataRequestTable[] = [
    makeTable("t1", "shop.public.customers"),
    makeTable("t2", "shop.public.orders"),
    makeTable("t3", "shop.public.order_items"),
    makeTable("t4", "shop.public.products"),
    makeTable("t5", "shop.public.hidden_tbl", { hidden: true }),
  ];

  const joins: DataRequestJoin[] = [
    {
      id: "j1",
      left: { tableId: "t2", column: "customer_id" },
      right: { tableId: "t1", column: "id" },
      type: "INNER",
    },
    {
      id: "j2",
      left: { tableId: "t3", column: "order_id" },
      right: { tableId: "t2", column: "id" },
      type: "INNER",
    },
  ];

  it("layoutGrid returns finite grid-snapped non-overlapping coordinates and ignores hidden tables", () => {
    const pos = layoutGrid(tables, null);
    expect(Object.keys(pos).sort()).toEqual(["t1", "t2", "t3", "t4"]);

    const rects = tables
      .filter((t) => !t.hidden)
      .map((t) => {
        const p = pos[t.id]!;
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(p.x % VISUAL_SCHEMA_GRID_SNAP).toBe(0);
        expect(p.y % VISUAL_SCHEMA_GRID_SNAP).toBe(0);
        return {
          x: p.x,
          y: p.y,
          w: SCHEMA_TABLE_WIDTH,
          h: estimateTableCardHeight(t),
        };
      });

    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(rectsOverlap(rects[i]!, rects[j]!)).toBe(false);
      }
    }
  });

  it("layoutConnectedGroups returns finite grid-snapped non-overlapping coordinates", async () => {
    const pos = await layoutConnectedGroups(tables, joins, null);
    expect(Object.keys(pos).sort()).toEqual(["t1", "t2", "t3", "t4"]);

    const rects = tables
      .filter((t) => !t.hidden)
      .map((t) => {
        const p = pos[t.id]!;
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(p.x % VISUAL_SCHEMA_GRID_SNAP).toBe(0);
        expect(p.y % VISUAL_SCHEMA_GRID_SNAP).toBe(0);
        return {
          x: p.x,
          y: p.y,
          w: SCHEMA_TABLE_WIDTH,
          h: estimateTableCardHeight(t),
        };
      });

    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(rectsOverlap(rects[i]!, rects[j]!)).toBe(false);
      }
    }
  });
});
