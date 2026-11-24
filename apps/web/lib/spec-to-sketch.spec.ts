import { BoardSketchSchema } from "@workspace/schemas/case-board";
import {
  EMPTY_DATA_REQUEST_SPEC,
  specToSketch,
  type DataRequestSpec,
} from "@workspace/schemas/data-request";

describe("specToSketch", () => {
  it("returns null for an empty spec", () => {
    expect(specToSketch(EMPTY_DATA_REQUEST_SPEC)).toBeNull();
  });

  it("produces a valid BoardSketch v1 for joined tables and comment pins", () => {
    const spec: DataRequestSpec = {
      tables: [
        {
          id: "t1",
          assetId: "a1",
          sqlName: "shop.public.orders",
          alias: "o",
          x: -40,
          y: 20,
          keep: ["id", "customer_id", "amount"],
          filters: [],
        },
        {
          id: "t2",
          assetId: "a2",
          sqlName: "crm.public.customers",
          alias: "c",
          x: 280,
          y: 40,
          keep: ["id", "region"],
          filters: [],
        },
      ],
      joins: [
        {
          id: "j1",
          left: { tableId: "t1", column: "customer_id" },
          right: { tableId: "t2", column: "id" },
          type: "LEFT",
        },
      ],
      pins: [
        {
          threadId: "th-1",
          anchor: null,
          x: 180,
          y: 150,
        },
      ],
    };

    const sketch = specToSketch(spec);
    expect(sketch).not.toBeNull();
    expect(sketch!.nodes).toHaveLength(3);
    expect(sketch!.edges).toEqual([{ a: 0, b: 1, t: "s" }]);
    // Must validate against BoardSketchCanvas's BoardSketchSchema
    const parsed = BoardSketchSchema.safeParse(sketch);
    expect(parsed.success).toBe(true);
  });
});
