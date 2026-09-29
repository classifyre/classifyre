import {
  ASSET_NODE,
  BOARD_SKETCH_MAX_NODES,
  BoardSketchSchema,
  estimateHypothesisHeight,
  FINDING_NODE,
} from "@workspace/schemas/case-board";
import { emptyDomain, tallyBubble } from "./domain";
import { buildBoardSketch, sketchSignature } from "./sketch";
import type { BoardDomain, BoardItem, BoardLink, BoardThread, Bubble, BubbleRow, SeverityKey } from "./types";

const item = (id: string, kind: BoardItem["kind"], extra: Partial<BoardItem> = {}): BoardItem => ({
  id,
  kind,
  refId: kind === "EVIDENCE" ? `ev-${id}` : null,
  x: 0,
  y: 0,
  width: kind === "NOTE" ? 220 : kind === "FRAME" ? 800 : null,
  height: kind === "NOTE" ? 160 : kind === "FRAME" ? 600 : null,
  z: 0,
  parentId: null,
  collapsed: false,
  style: {},
  content: {},
  createdBy: null,
  updatedBy: null,
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...extra,
});

const row = (findingId: string, severity: SeverityKey = "medium", extra: Partial<BubbleRow> = {}): BubbleRow => ({
  findingId,
  caseFindingId: `cf-${findingId}`,
  typeLabel: "email",
  value: `${findingId}@example.com`,
  severity,
  detector: "pii",
  status: "OPEN",
  matchState: null,
  missing: false,
  state: "open",
  note: null,
  escalated: false,
  escalationLabel: null,
  escalatedAt: null,
  ...extra,
});

const bubble = (itemId: string, rows: BubbleRow[], label = `Asset ${itemId}`): Bubble =>
  tallyBubble({
    itemId,
    evidenceId: `ev-${itemId}`,
    assetId: `asset-${itemId}`,
    label,
    assetType: "FILE",
    sourceType: null,
    sourceName: null,
    missing: false,
    rows,
    unattached: [],
    severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    newCount: 0,
    escalatedCount: 0,
    maxSeverity: null,
  });

const link = (id: string, source: string, target: string, extra: Partial<BoardLink> = {}): BoardLink => ({
  id,
  sourceItemId: source,
  sourceFindingId: null,
  targetItemId: target,
  targetFindingId: null,
  kind: "related_to",
  label: null,
  certainty: "CONFIRMED",
  confidence: null,
  note: null,
  promotedEdgeId: null,
  createdBy: null,
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...extra,
});

const thread = (id: string, extra: Partial<BoardThread> = {}): BoardThread => ({
  id,
  kind: "HYPOTHESIS",
  title: "The payroll export leaked through the wiki",
  status: "PROPOSED",
  confidence: null,
  color: null,
  createdBy: null,
  entryCount: 1,
  lastEntryAt: null,
  lastAuthor: null,
  lastExcerpt: null,
  supportingCount: 0,
  contradictingCount: 0,
  neutralCount: 0,
  resolvedAt: null,
  resolvedBy: null,
  itemId: null,
  onBoard: true,
  ...extra,
});

/** Two assets linked by hand, a note inside a frame, and a hypothesis card. */
function fixture(): BoardDomain {
  const d = emptyDomain();
  const items = [
    item("A", "EVIDENCE", { x: 100, y: 100 }),
    item("B", "EVIDENCE", { x: 700, y: 100, collapsed: true, style: { highlight: "pink" } }),
    item("F", "FRAME", { x: 1000, y: 0, content: { title: "Timeline" }, style: { color: "blue" } }),
    item("N", "NOTE", { x: 40, y: 60, parentId: "F", content: { text: "## Ask **HR** about [the share](https://x)" } }),
    item("H", "HYPOTHESIS", { x: 300, y: 500, refId: "T1" }),
  ];
  for (const i of items) d.items.set(i.id, i);
  d.bubbles.set("A", bubble("A", [row("f1", "high"), row("f2", "low", { state: "resolved" })]));
  d.bubbles.set("B", bubble("B", [row("f3", "critical")]));
  d.threads.set("T1", thread("T1", { itemId: "H" }));
  d.links.set("L", link("L", "A", "B", { certainty: "SUSPECTED" }));
  return d;
}

describe("buildBoardSketch", () => {
  it("draws what the canvas shows, in a box that starts at the origin", () => {
    const sketch = buildBoardSketch(fixture());
    expect(BoardSketchSchema.safeParse(sketch).success).toBe(true);
    expect(sketch.nodes.map((n) => n.t).sort()).toEqual(["a", "a", "f", "f", "h", "n", "r"]);
    // The leftmost shape is asset A's node: its circle sits at the node's centre offsets.
    const a = sketch.nodes.find((n) => n.t === "a" && n.l === "Asset A");
    expect(a).toMatchObject({ x: ASSET_NODE.cx, y: expect.any(Number) });
    const frame = sketch.nodes.find((n) => n.t === "r");
    expect(frame).toMatchObject({ w: 800, h: 600, c: "blue", l: "Timeline" });
    expect(sketch.w).toBe(1000 + 800 - 100);
  });

  it("places a frame's children by the frame", () => {
    const sketch = buildBoardSketch(fixture());
    const frame = sketch.nodes.find((n) => n.t === "r")!;
    const note = sketch.nodes.find((n) => n.t === "n")!;
    expect(note.x - frame.x).toBe(40);
    expect(note.y - frame.y).toBe(60);
    // Markdown reads as its words.
    expect(note).toMatchObject({ c: "yellow", l: "Ask HR about the share" });
  });

  it("keeps a finding's severity and dims one that was dealt with", () => {
    const sketch = buildBoardSketch(fixture());
    const findings = sketch.nodes.filter((n) => n.t === "f");
    expect(findings).toEqual([
      expect.objectContaining({ s: "high" }),
      expect.objectContaining({ s: "low", o: true }),
    ]);
    const asset = sketch.nodes.find((n) => n.t === "a" && n.l === "Asset A")!;
    for (const f of findings) {
      // Findings hang off their asset, as its children.
      expect(Math.abs(f.x - asset.x)).toBeLessThan(400);
      expect(f.x - FINDING_NODE.cx).toBeGreaterThanOrEqual(0);
    }
  });

  it("folds a collapsed asset's findings into its worst severity", () => {
    const sketch = buildBoardSketch(fixture());
    expect(sketch.nodes.find((n) => n.t === "a" && n.l === "Asset B")).toMatchObject({ d: "critical", h: "pink" });
  });

  it("draws links, contains edges and stances in their own styles", () => {
    const d = fixture();
    d.supports.set("S1", {
      id: "S1",
      threadId: "T1",
      stance: "CONTRADICTS",
      weight: null,
      note: null,
      endpoint: { itemId: "A", findingId: null },
    });
    const sketch = buildBoardSketch(d);
    const styles = sketch.edges.map((e) => e.t).sort();
    expect(styles).toEqual(["-", "c", "c", "q"]);
    const suspected = sketch.edges.find((e) => e.t === "q")!;
    expect(sketch.nodes[suspected.a]).toMatchObject({ t: "a", l: "Asset A" });
    expect(sketch.nodes[suspected.b]).toMatchObject({ t: "a", l: "Asset B" });
  });

  it("gives a hypothesis card its colour and a size from its statement", () => {
    const sketch = buildBoardSketch(fixture());
    expect(sketch.nodes.find((n) => n.t === "h")).toMatchObject({
      w: 300,
      h: estimateHypothesisHeight("The payroll export leaked through the wiki"),
      c: "#ef4444",
      l: "The payroll export leaked through the wiki",
    });
  });

  it("leaves out what a collapsed frame hides", () => {
    const d = fixture();
    d.items.set("F", { ...d.items.get("F")!, collapsed: true });
    const sketch = buildBoardSketch(d);
    expect(sketch.nodes.some((n) => n.t === "n")).toBe(false);
    expect(sketch.nodes.find((n) => n.t === "r")).toMatchObject({ k: true });
  });

  it("keeps the structure of a board too big for one sketch", () => {
    const d = emptyDomain();
    for (let i = 0; i < 300; i++) {
      const id = `E${i}`;
      d.items.set(id, item(id, "EVIDENCE", { x: (i % 20) * 400, y: Math.floor(i / 20) * 400 }));
      d.bubbles.set(id, bubble(id, [row(`${id}-a`), row(`${id}-b`, "critical")]));
    }
    d.items.set("N", item("N", "NOTE", { x: -500, y: -500 }));
    const sketch = buildBoardSketch(d);
    expect(sketch.nodes).toHaveLength(BOARD_SKETCH_MAX_NODES);
    // The note and every asset make it; findings fill what room is left.
    expect(sketch.nodes.filter((n) => n.t === "n")).toHaveLength(1);
    expect(sketch.nodes.filter((n) => n.t === "a")).toHaveLength(BOARD_SKETCH_MAX_NODES - 1);
    expect(BoardSketchSchema.safeParse(sketch).success).toBe(true);
  });

  it("cuts long labels to what a sketch keeps", () => {
    const d = fixture();
    d.bubbles.set("A", bubble("A", [], "x".repeat(300)));
    const sketch = buildBoardSketch(d);
    const asset = sketch.nodes.find((n) => n.t === "a" && n.l?.startsWith("x"));
    const label = asset?.t === "a" ? (asset.l ?? "") : "";
    expect(label.length).toBeLessThanOrEqual(80);
    expect(label.endsWith("…")).toBe(true);
  });

  it("is an empty sketch for an empty board", () => {
    expect(buildBoardSketch(emptyDomain())).toEqual({ v: 1, w: 0, h: 0, nodes: [], edges: [] });
  });
});

describe("sketchSignature", () => {
  it("changes with the drawing and only with it", () => {
    const one = buildBoardSketch(fixture());
    const again = buildBoardSketch(fixture());
    expect(sketchSignature(one)).toBe(sketchSignature(again));
    const d = fixture();
    d.items.set("A", { ...d.items.get("A")!, x: 140 });
    expect(sketchSignature(buildBoardSketch(d))).not.toBe(sketchSignature(one));
    expect(sketchSignature(one)).toMatch(/^[a-z0-9]{1,64}$/);
  });
});
