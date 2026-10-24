import type { MapNode } from "@/lib/semantic-api";
import { CONCEPT_SIZE, separateRects, taxonomyLayout } from "./meaning-map-layout";

const scheme = (id: string) => ({ id, key: id, name: id.toUpperCase(), color: "#888888" });

function concept(
  termId: string,
  schemeId: string | null,
  totalAssetCount: number,
  broaderIds: string[] = [],
): MapNode {
  return {
    termId,
    key: termId,
    name: termId,
    kind: "CONCEPT",
    definition: null,
    scheme: schemeId ? scheme(schemeId) : null,
    directAssetCount: totalAssetCount,
    totalAssetCount,
    findingCount: totalAssetCount,
    sourceCount: 1,
    severityCounts: {},
    lastLinkedAt: null,
    pendingProposals: 0,
    broaderIds,
    context: false,
  };
}

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }) {
  return (
    Math.abs(a.x - b.x) < CONCEPT_SIZE.width && Math.abs(a.y - b.y) < CONCEPT_SIZE.height
  );
}

describe("taxonomyLayout", () => {
  const nodes = [
    concept("distress", "risk", 120),
    concept("late-filing", "risk", 88, ["distress"]),
    concept("equity-erosion", "risk", 20, ["distress"]),
    concept("insolvency", "risk", 300),
    concept("gmbh", "forms", 600),
    concept("kg", "forms", 99),
    concept("orphan", null, 5),
  ];

  it("gives every scheme one frame, heaviest first", () => {
    const layout = taxonomyLayout(nodes, { width: 1200, height: 600 });
    expect(layout.frames.map((frame) => frame.id)).toEqual([
      "scheme:forms",
      "scheme:risk",
      "scheme:none",
    ]);
    expect(layout.frames.find((f) => f.id === "scheme:risk")?.conceptIds).toEqual([
      "insolvency",
      "distress",
      "late-filing",
      "equity-erosion",
    ]);
  });

  it("indents narrower concepts under their broader one", () => {
    const layout = taxonomyLayout(nodes, { width: 1200, height: 600 });
    const parent = layout.concepts.get("distress")!;
    const child = layout.concepts.get("late-filing")!;
    expect(child.parentId).toBe("distress");
    expect(child.depth).toBe(1);
    expect(child.x).toBeGreaterThan(parent.x);
    expect(child.y).toBeGreaterThan(parent.y);
  });

  it("never overlaps two cards, and keeps cards inside their frame", () => {
    const layout = taxonomyLayout(nodes, { width: 900, height: 300 });
    const placed = [...layout.concepts.values()];
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        expect(overlaps(placed[i]!, placed[j]!)).toBe(false);
      }
    }
    for (const card of placed) {
      const frame = layout.frames.find((f) => f.id === card.frameId)!;
      expect(card.x + CONCEPT_SIZE.width).toBeLessThanOrEqual(frame.x + frame.width);
      expect(card.y + CONCEPT_SIZE.height).toBeLessThanOrEqual(frame.y + frame.height);
    }
  });

  it("spreads frames into columns on a wide viewport instead of one tall stack", () => {
    const many = Array.from({ length: 8 }, (_, s) =>
      Array.from({ length: 6 }, (_, c) => concept(`s${s}-c${c}`, `s${s}`, 100 - c)),
    ).flat();
    const wide = taxonomyLayout(many, { width: 1400, height: 600 });
    const columns = new Set(wide.frames.map((frame) => frame.x));
    expect(columns.size).toBeGreaterThan(2);
    const tall = taxonomyLayout(many, { width: 400, height: 1400 });
    expect(new Set(tall.frames.map((frame) => frame.x)).size).toBeLessThan(columns.size);
  });

  it("flows a tall flat scheme into several columns, keeping a subtree together", () => {
    const flat = [
      ...Array.from({ length: 30 }, (_, i) => concept(`industry-${i}`, "industries", 500 - i)),
      concept("finance", "industries", 600),
      concept("banking", "industries", 300, ["finance"]),
      concept("insurance", "industries", 200, ["finance"]),
    ];
    const layout = taxonomyLayout(flat, { width: 1400, height: 500 });
    const frame = layout.frames[0]!;
    const columns = new Set([...layout.concepts.values()].map((card) => card.x));
    expect(frame.width).toBeGreaterThan(CONCEPT_SIZE.width * 2);
    expect(columns.size).toBeGreaterThan(2);
    const parent = layout.concepts.get("finance")!;
    for (const id of ["banking", "insurance"]) {
      const child = layout.concepts.get(id)!;
      expect(child.x).toBeGreaterThan(parent.x);
      expect(child.x - parent.x).toBeLessThan(CONCEPT_SIZE.width);
      expect(child.y).toBeGreaterThan(parent.y);
    }
  });

  it("gives an empty scheme a frame of its own", () => {
    const layout = taxonomyLayout(nodes, { width: 1200, height: 600 }, [scheme("fresh")]);
    const frame = layout.frames.find((f) => f.id === "scheme:fresh")!;
    expect(frame.conceptIds).toEqual([]);
    expect(frame.height).toBeGreaterThan(CONCEPT_SIZE.height);
  });

  it("survives a broader cycle", () => {
    const layout = taxonomyLayout(
      [concept("a", "x", 10, ["b"]), concept("b", "x", 5, ["a"])],
      { width: 800, height: 600 },
    );
    expect(layout.concepts.size).toBe(2);
  });
});

describe("separateRects", () => {
  it("pushes stacked cards apart", () => {
    const centres = Array.from({ length: 12 }, (_, i) => ({ x: i % 3, y: i % 2 }));
    separateRects(centres, CONCEPT_SIZE, 8);
    for (let i = 0; i < centres.length; i += 1) {
      for (let j = i + 1; j < centres.length; j += 1) {
        expect(overlaps(centres[i]!, centres[j]!)).toBe(false);
      }
    }
  });
});
