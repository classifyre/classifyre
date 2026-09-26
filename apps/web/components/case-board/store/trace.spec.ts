import type { BoardTraceResponseDto } from "@workspace/api-client";
import { emptyDomain } from "./domain";
import { projectNodes, type ProjectionView } from "./projection";
import { edgeKind, layoutTrace, mergeTraceNeighbourhood, pathToSeed, type TraceKind, type TraceNodeData } from "./trace";
import type { BoardItem } from "./types";

type Node = { id: string; position: { x: number; y: number }; data?: TraceNodeData };

const item = (id: string, x: number, y: number): BoardItem => ({
  id,
  kind: "EVIDENCE",
  refId: `ev-${id}`,
  x,
  y,
  width: null,
  height: null,
  z: 0,
  parentId: null,
  collapsed: false,
  style: {},
  content: {},
  createdBy: null,
  updatedBy: null,
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const node = (id: string, side: "seed" | "up" | "down" | "side", depth: number, via: string | null = null, type = "asset") => ({
  id,
  type,
  label: `Asset ${id}`,
  assetType: "FILE",
  sourceType: null,
  sourceName: null,
  status: null,
  missing: false,
  depth,
  side,
  via,
  viaKind: via ? ("lineage" as const) : null,
});

const edge = (id: string, from: string, to: string, kind: TraceKind = "lineage") => ({
  id,
  fromType: "asset",
  fromId: from,
  toType: "asset",
  toId: to,
  relationType: kind === "lineage" ? "TRANSFORM" : "likely_duplicate",
  relationClass: kind === "lineage" ? "FLOW" : null,
  kind,
  confidence: 1,
});

/** A walk from A: U feeds A, A feeds D and C (C is on the board), A has a duplicate S; U2 feeds U. */
const trace: BoardTraceResponseDto = {
  nodes: [
    node("A", "seed", 0),
    node("U", "up", 1, "A"),
    node("U2", "up", 2, "U"),
    node("D", "down", 1, "A"),
    node("C", "down", 1, "A"),
    node("S", "side", 1, "A"),
  ],
  edges: [edge("e1", "U", "A"), edge("e2", "U2", "U"), edge("e3", "A", "D"), edge("e4", "A", "C"), edge("e5", "A", "S", "duplicates")],
  truncated: false,
} as BoardTraceResponseDto;

function boardWith(...items: BoardItem[]) {
  const d = emptyDomain();
  for (const i of items) {
    d.items.set(i.id, i);
    d.itemByAsset.set(i.id.replace("item-", ""), i.id);
  }
  return d;
}

const layout = (d: ReturnType<typeof emptyDomain>, projected: Node[] = [], projectedEdgeIds = new Set<string>()) =>
  layoutTrace<Node>({
    result: trace,
    seedNodeId: "item-A",
    domain: d,
    projected,
    projectedEdgeIds,
    taken: [],
    makeNode: (id, position, data) => ({ id, position, data }),
  });

describe("edgeKind", () => {
  it("groups relations the way the server walks them", () => {
    expect(edgeKind({ relationType: "TRANSFORM", relationClass: "FLOW" })).toBe("lineage");
    expect(edgeKind({ relationType: "likely_duplicate", relationClass: "REFERENCE" })).toBe("duplicates");
    expect(edgeKind({ relationType: "SAME_AS", relationClass: "IDENTITY" })).toBe("duplicates");
    expect(edgeKind({ relationType: "related", relationClass: "REFERENCE" })).toBe("similar");
    expect(edgeKind({ relationType: "ACCESSED", relationClass: "USAGE" })).toBe("links");
  });
});

describe("layoutTrace", () => {
  it("puts upstream to the left of the seed, downstream to the right, one column per hop", () => {
    const d = boardWith(item("item-A", 1000, 1000), item("item-C", 2000, 400));
    const out = layout(d);
    const pos = (id: string) => out.nodes.find((n) => n.id === id)!.position;
    expect(pos("tr:U").x).toBeLessThan(1000);
    expect(pos("tr:U2").x).toBeLessThan(pos("tr:U").x);
    expect(pos("tr:D").x).toBeGreaterThan(1000);
    expect(out.nodes.find((n) => n.id === "tr:U")!.data).toMatchObject({ side: "up", depth: 1, external: false });
  });

  it("joins what is on the board in place and draws ghosts only for the rest", () => {
    const d = boardWith(item("item-A", 1000, 1000), item("item-C", 2000, 400));
    const out = layout(d);
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["tr:D", "tr:S", "tr:U", "tr:U2"]);
    expect(out.nodeOf.get("asset:C")).toBe("item-C");
    expect(out.nodeOf.get("asset:A")).toBe("item-A");
    expect(out.keep).toEqual(new Set(["item-A", "item-C", "tr:U", "tr:U2", "tr:D", "tr:S"]));
  });

  it("reuses a suggested neighbour instead of doubling it with a ghost", () => {
    const d = boardWith(item("item-A", 1000, 1000));
    const out = layout(d, [{ id: "sg:D", position: { x: 1300, y: 1000 } }]);
    expect(out.nodeOf.get("asset:D")).toBe("sg:D");
    expect(out.nodes.some((n) => n.id === "tr:D")).toBe(false);
  });

  it("draws each relation once: not over a system edge the board already shows", () => {
    const d = boardWith(item("item-A", 1000, 1000), item("item-C", 2000, 400));
    const out = layout(d, [], new Set(["sys:e4"]));
    expect(out.edges.map((e) => e.id).sort()).toEqual(["tre:e1", "tre:e2", "tre:e3", "tre:e5"]);
    expect(out.edges.find((e) => e.id === "tre:e1")).toMatchObject({ source: "tr:U", target: "item-A" });
  });

  it("keeps a ghost for a seed that is neither on the board nor suggested", () => {
    const d = boardWith();
    const out = layoutTrace<Node>({
      result: trace,
      seedNodeId: "tr:A",
      seedPosition: { x: 50, y: 60 },
      domain: d,
      projected: [],
      projectedEdgeIds: new Set(),
      taken: [],
      makeNode: (id, position, data) => ({ id, position, data }),
    });
    expect(out.nodes.find((n) => n.id === "tr:A")).toMatchObject({ position: { x: 50, y: 60 } });
  });
});

describe("pathToSeed", () => {
  it("walks back to the seed, nearest first", () => {
    expect(pathToSeed(trace, "U2").map((n) => n.id)).toEqual(["U2", "U"]);
    expect(pathToSeed(trace, "A")).toEqual([]);
  });
});

describe("mergeTraceNeighbourhood", () => {
  it("turns what a walk reached into suggestions that know their hop and what they hang off", () => {
    const d = boardWith(item("item-A", 1000, 1000), item("item-C", 2000, 400));
    const merged = mergeTraceNeighbourhood(d, trace);
    expect(merged.suggested.get("sg:U")).toMatchObject({ hop: 1, via: "item-A", neighbourOf: ["item-A"] });
    expect(merged.suggested.get("sg:U2")).toMatchObject({ hop: 2, via: "sg:U", neighbourOf: [] });
    // In the case already: no suggestion.
    expect(merged.suggested.has("sg:C")).toBe(false);
    expect(merged.systemEdges.get("e2")).toMatchObject({ from: "asset:U2", to: "asset:U", relationClass: "FLOW" });
    expect(merged.systemEdges.get("e5")).toMatchObject({ relationClass: "IDENTITY" });
  });

  it("keeps the nearer hop for a neighbour reached two ways", () => {
    const d = boardWith(item("item-A", 1000, 1000));
    d.suggested.set("sg:U2", { key: "sg:U2", assetId: "U2", label: "U2", assetType: null, sourceType: null, sourceName: null, neighbourOf: ["item-A"], hop: 1 });
    const merged = mergeTraceNeighbourhood(d, trace);
    expect(merged.suggested.get("sg:U2")).toMatchObject({ hop: 1, neighbourOf: ["item-A"] });
  });
});

describe("projection: neighbours beyond the first hop", () => {
  const view = (patch: Partial<ProjectionView> = {}): ProjectionView => ({
    lod: "full",
    readOnly: false,
    neighbourHops: 3,
    hiddenSuggestions: new Set(),
    showResolvedComments: false,
    showAllRows: new Set(),
    expandedUnattached: new Set(),
    kinds: new Set(["lineage", "links", "duplicates", "similar"]),
    ...patch,
  });

  it("lays the second hop out beyond the first", () => {
    const d = mergeTraceNeighbourhood(boardWith(item("item-A", 1000, 1000)), trace);
    const nodes = projectNodes(d, view());
    const first = nodes.find((n) => n.id === "sg:U")!;
    const second = nodes.find((n) => n.id === "sg:U2")!;
    expect(second.position.x).toBeGreaterThan(first.position.x);
  });

  it("stops at the hops the View asks for", () => {
    const d = mergeTraceNeighbourhood(boardWith(item("item-A", 1000, 1000)), trace);
    const ids = projectNodes(d, view({ neighbourHops: 1 })).map((n) => n.id);
    expect(ids).toContain("sg:U");
    expect(ids).not.toContain("sg:U2");
    expect(projectNodes(d, view({ neighbourHops: 0 })).some((n) => n.type === "suggested")).toBe(false);
  });

  it("hides a neighbour whose every relation is of a kind switched off", () => {
    const d = mergeTraceNeighbourhood(boardWith(item("item-A", 1000, 1000)), trace);
    const ids = projectNodes(d, view({ kinds: new Set<TraceKind>(["lineage"]) })).map((n) => n.id);
    expect(ids).toContain("sg:U");
    expect(ids).not.toContain("sg:S");
  });
});
