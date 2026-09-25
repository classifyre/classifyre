import { emptyDomain, tallyBubble } from "./domain";
import { findingVisualState } from "./finding-state";
import { applyAll, coalesce, type BoardOp, type LocalContext } from "./ops";
import {
  addNote,
  createLink,
  deleteItems,
  deleteLinks,
  editText,
  moveFindings,
  moveItems,
  resetFindingPositions,
  resizeItem,
  setCollapsed,
  setRowHighlight,
  setStyle,
  type Command,
} from "./commands";
import {
  bendParallel,
  makeResolver,
  projectEdges,
  projectNodes,
  visibleRowIds,
  type BoardEdge,
  type ProjectionView,
} from "./projection";
import { findingNodeId, MAX_FINDING_NODES, SOURCE_PORT, TARGET_PORT } from "./relations";
import { FRAME_PADDING, FRAME_TITLE_HEIGHT, itemExtent, overlaps, spotInFrame } from "./geometry";
import { evidenceStatus } from "./selectors";
import type { BoardDomain, BoardItem, BoardLink, Bubble, BubbleRow, SeverityKey } from "./types";

const ctx: LocalContext = { actor: "tester", previews: new Map(), now: "2026-09-24T12:00:00.000Z" };

const item = (id: string, kind: BoardItem["kind"], extra: Partial<BoardItem> = {}): BoardItem => ({
  id,
  kind,
  refId: kind === "EVIDENCE" ? `ev-${id}` : null,
  x: 0,
  y: 0,
  width: kind === "NOTE" ? 220 : null,
  height: kind === "NOTE" ? 160 : null,
  z: 0,
  parentId: null,
  collapsed: false,
  style: {},
  content: kind === "NOTE" ? { text: "hello" } : {},
  createdBy: null,
  updatedBy: null,
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...extra,
});

const row = (findingId: string, severity: SeverityKey = "medium"): BubbleRow => ({
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
});

const bubble = (itemId: string, rows: BubbleRow[], unattached: BubbleRow[] = []): Bubble =>
  tallyBubble({
    itemId,
    evidenceId: `ev-${itemId}`,
    assetId: `asset-${itemId}`,
    label: `Asset ${itemId}`,
    assetType: "FILE",
    sourceType: null,
    sourceName: null,
    missing: false,
    rows,
    unattached,
    severityCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    newCount: 0,
    maxSeverity: null,
  });

const link = (id: string, source: string, target: string): BoardLink => ({
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
});

function fixture(): BoardDomain {
  const d = emptyDomain();
  const e = item("E", "EVIDENCE");
  const n = item("N", "NOTE", { x: 400, y: 40 });
  const f = item("F", "FRAME", { x: -100, y: -100, width: 800, height: 600, content: { title: "Area" } });
  const m = item("M", "NOTE", { x: 20, y: 20, parentId: "F" });
  for (const i of [e, n, f, m]) d.items.set(i.id, i);
  d.bubbles.set("E", bubble("E", [row("f1", "high"), row("f2", "low"), row("f3")], [row("u1")]));
  d.links.set("L", link("L", "E", "N"));
  return d;
}

/** What the user sees of items and links, minus who touched them when. */
function visible(d: BoardDomain) {
  const strip = ({ updatedAt: _u, updatedBy: _b, pending: _p, ...rest }: BoardItem) => rest;
  return {
    items: [...d.items.values()].map(strip).sort((a, b) => a.id.localeCompare(b.id)),
    links: [...d.links.values()].map(({ updatedAt: _u, createdBy: _c, ...rest }) => rest),
  };
}

function roundTrip(d: BoardDomain, cmd: Command) {
  const forward = applyAll(d, cmd.forward, ctx);
  const back = applyAll(forward.domain, cmd.inverse, ctx);
  return { forward: forward.domain, back: back.domain, exact: forward.exact && back.exact };
}

describe("findingVisualState", () => {
  it("ranks deleted over gone over the triage status over new", () => {
    expect(findingVisualState({ missing: true, matchState: "GONE", status: "RESOLVED" })).toBe("deleted");
    expect(findingVisualState({ matchState: "GONE", status: "RESOLVED" })).toBe("gone");
    expect(findingVisualState({ matchState: "NEW", status: "RESOLVED" })).toBe("resolved");
    expect(findingVisualState({ status: "FALSE_POSITIVE" })).toBe("dismissed");
    expect(findingVisualState({ status: "IGNORED" })).toBe("dismissed");
    expect(findingVisualState({ matchState: "NEW", status: "OPEN" })).toBe("new");
    expect(findingVisualState({ status: "OPEN" })).toBe("open");
  });
});

describe("commands: undo is the exact inverse of do", () => {
  const cases: Array<[string, (d: BoardDomain) => Command]> = [
    ["add a note", () => addNote({ x: 10, y: 20 }, { text: "new" })],
    [
      "move items, into and out of a frame",
      () =>
        moveItems([
          { id: "N", from: { x: 400, y: 40, parentId: null }, to: { x: 30, y: 30, parentId: "F" } },
          { id: "M", from: { x: 20, y: 20, parentId: "F" }, to: { x: 900, y: 900, parentId: null } },
        ]),
    ],
    ["resize a note", (d) => resizeItem(d.items.get("N")!, { x: 380, y: 20, width: 300, height: 240 })],
    ["collapse evidence into its donut", (d) => setCollapsed(d.items.get("E")!, true)],
    ["recolour a note", (d) => setStyle([d.items.get("N")!], { color: "pink" })],
    ["highlight one finding", (d) => setRowHighlight(d.items.get("E")!, "f2", "yellow")],
    ["edit a note's text", (d) => editText(d.items.get("N")!, "rewritten")],
    ["draw a link between findings", () => createLink({ source: { itemId: "E", findingId: "f1" }, target: { itemId: "N" }, kind: "same_entity", certainty: "SUSPECTED" })],
    ["delete a link", (d) => deleteLinks([d.links.get("L")!])],
    ["delete a frame and keep its children", (d) => deleteItems(d, [d.items.get("F")!])],
    [
      "drag a finding away from its default spot",
      (d) => moveFindings(d.items.get("E")!, [{ findingId: "f1", from: null, to: { x: 300, y: -40 } }]),
    ],
    [
      "drag an already moved finding again",
      (d) => {
        const e = d.items.get("E")!;
        const moved = { ...e, style: { findingPositions: { f2: { x: 10, y: 10 } } } };
        d.items.set("E", moved);
        return moveFindings(moved, [{ findingId: "f2", from: { x: 10, y: 10 }, to: { x: 99, y: 99 } }]);
      },
    ],
    [
      "tidy-up sends moved findings back",
      (d) => {
        const moved = { ...d.items.get("E")!, style: { findingPositions: { f1: { x: 1, y: 2 }, f3: { x: 3, y: 4 } } } };
        d.items.set("E", moved);
        return resetFindingPositions(moved)!;
      },
    ],
  ];

  it.each(cases)("%s", (_name, build) => {
    const d = fixture();
    const cmd = build(d);
    const { forward, back, exact } = roundTrip(d, cmd);
    expect(exact).toBe(true);
    expect(visible(forward)).not.toEqual(visible(d));
    expect(visible(back)).toEqual(visible(d));
  });

  it("redo after undo restores the same ids", () => {
    const d = fixture();
    const cmd = addNote({ x: 1, y: 2 }, { text: "again" });
    const once = applyAll(d, cmd.forward, ctx).domain;
    const undone = applyAll(once, cmd.inverse, ctx).domain;
    const redone = applyAll(undone, cmd.forward, ctx).domain;
    expect(redone.items.get(cmd.id)?.content.text).toBe("again");
    expect(visible(redone)).toEqual(visible(once));
  });

  it("never deletes evidence locally", () => {
    const d = fixture();
    const cmd = deleteItems(d, [d.items.get("E")!, d.items.get("N")!]);
    const out = applyAll(d, cmd.forward, ctx).domain;
    expect(out.items.has("E")).toBe(true);
    expect(out.items.has("N")).toBe(false);
  });
});

describe("coalesce", () => {
  const move = (id: string, x: number): BoardOp => ({ type: "item.update", opId: `${id}-${x}`, id, patch: { x, y: 0 } });

  it("folds a drag storm on one item into its last position", () => {
    const out = coalesce([move("A", 1), move("A", 2), move("A", 3)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "A", patch: { x: 3, y: 0 } });
  });

  it("keeps different items, style patches and guarded text edits apart", () => {
    const styled: BoardOp = { type: "item.update", opId: "s", id: "A", patch: { style: { color: "blue" } } };
    const text: BoardOp = { type: "item.update", opId: "t", id: "A", patch: { content: { text: "x" } }, expectedUpdatedAt: "now" };
    expect(coalesce([move("A", 1), move("B", 1), move("A", 2)])).toHaveLength(3);
    expect(coalesce([move("A", 1), styled, move("A", 2)])).toHaveLength(3);
    expect(coalesce([text, move("A", 2)])).toHaveLength(2);
  });
});

describe("projection: assets and their findings as nodes", () => {
  const view = (patch: Partial<ProjectionView> = {}): ProjectionView => ({
    lod: "full",
    readOnly: false,
    showSuggested: false,
    hiddenSuggestions: new Set(),
    showResolvedComments: false,
    showAllRows: new Set(),
    expandedUnattached: new Set(),
    edgeClasses: new Set(["FLOW", "IDENTITY", "REFERENCE"]),
    ...patch,
  });
  const projected = (d: BoardDomain, v: ProjectionView) => new Set(projectNodes(d, v).map((n) => n.id));

  it("draws each attached finding as a child node of its asset, ghosts only while shown", () => {
    const d = fixture();
    const nodes = projectNodes(d, view());
    const findings = nodes.filter((n) => n.type === "finding");
    expect(findings.map((n) => n.id).sort()).toEqual(["f1", "f2", "f3"].map((f) => findingNodeId("E", f)));
    expect(findings.every((n) => n.parentId === "E" && n.draggable)).toBe(true);
    // React Flow needs every parent before its children.
    expect(nodes.findIndex((n) => n.id === "E")).toBeLessThan(nodes.findIndex((n) => n.type === "finding"));
    const withGhosts = projectNodes(d, view({ expandedUnattached: new Set(["E"]) })).filter((n) => n.type === "finding");
    expect(withGhosts).toHaveLength(4);
    expect(withGhosts.find((n) => n.id === findingNodeId("E", "u1"))?.data).toMatchObject({ attached: false });
  });

  it("shows no finding nodes for a collapsed asset or at far zoom", () => {
    const d = fixture();
    const b = d.bubbles.get("E")!;
    expect(visibleRowIds(b, d.items.get("E")!, view({ lod: "chip" })).size).toBe(0);
    expect(visibleRowIds(b, { ...d.items.get("E")!, collapsed: true }, view()).size).toBe(0);
    expect(visibleRowIds(b, d.items.get("E")!, view({ lod: "compact" })).size).toBe(3);
    d.items.set("E", { ...d.items.get("E")!, collapsed: true });
    expect(projectNodes(d, view()).some((n) => n.type === "finding")).toBe(false);
  });

  it("keeps a finding where the user dropped it, relative to its asset", () => {
    const d = fixture();
    d.items.set("E", { ...d.items.get("E")!, style: { findingPositions: { f2: { x: -200, y: 15 } } } });
    const node = projectNodes(d, view()).find((n) => n.id === findingNodeId("E", "f2"))!;
    expect(node.position).toEqual({ x: -200, y: 15 });
  });

  it("ends a link on a finding's node while it is shown, on the asset once folded", () => {
    const d = fixture();
    const rows = Array.from({ length: MAX_FINDING_NODES + 3 }, (_, i) => row(`f${i}`));
    d.bubbles.set("E", bubble("E", rows));
    const first = d.bubbles.get("E")!.rows[0]!.findingId;
    const last = d.bubbles.get("E")!.rows.at(-1)!.findingId;
    const v = view();
    const resolver = makeResolver(d, v, projected(d, v));
    expect(resolver.itemEnd("E", first)).toEqual({ nodeId: findingNodeId("E", first) });
    expect(resolver.itemEnd("E", last)).toEqual({ nodeId: "E" });
    const all = view({ showAllRows: new Set(["E"]) });
    expect(makeResolver(d, all, projected(d, all)).itemEnd("E", last)).toEqual({
      nodeId: findingNodeId("E", last),
    });
  });

  it("joins each finding to its asset with a contains edge, and a link to the finding itself", () => {
    const d = fixture();
    d.links.set("L2", { ...link("L2", "N", "E"), targetFindingId: "f1" });
    const v = view();
    const nodes = projectNodes(d, v);
    const edges = projectEdges(d, v, nodes);
    const contains = edges.filter((e) => e.type === "contains");
    expect(contains).toHaveLength(3);
    expect(contains.every((e) => e.source === "E")).toBe(true);
    expect(edges.find((e) => e.id === "lnk:L2")?.target).toBe(findingNodeId("E", "f1"));
  });

  it("carries a round shape on asset and finding nodes, none on cards", () => {
    const nodes = projectNodes(fixture(), view());
    expect((nodes.find((n) => n.id === "E")!.data as { round?: unknown }).round).toBeDefined();
    expect((nodes.find((n) => n.type === "finding")!.data as { round?: unknown }).round).toBeDefined();
    expect((nodes.find((n) => n.id === "N")!.data as { round?: unknown }).round).toBeUndefined();
  });
});

describe("bendParallel", () => {
  const edge = (id: string, source: string, target: string): BoardEdge => ({ id, source, target, type: "link", data: {} });

  it("leaves a lone edge straight and bows parallel ones apart, either direction", () => {
    const edges = bendParallel([edge("a", "X", "Y"), edge("b", "X", "Y"), edge("c", "Y", "X"), edge("d", "X", "Z")]);
    const bend = (id: string) => edges.find((e) => e.id === id)!.data?.bend;
    expect(bend("d")).toBeUndefined();
    expect(bend("a")).toBe(0);
    // b and c bow to opposite sides of the X–Y line.
    expect(Math.sign(bend("b")!)).toBe(1);
    expect(Math.sign(bend("c")!)).toBe(1); // reversed direction, so the same sign means the other side
    expect(new Set(edges.filter((e) => e.source !== "Z" && e.target !== "Z").map((e) => e.data?.bend))).toEqual(new Set([0, 1, 1]));
  });
});

describe("moving into a frame", () => {
  const frameWith = (children: BoardItem[], size = { width: 640, height: 400 }) => {
    const d = emptyDomain();
    const frame = item("FR", "FRAME", { x: 1000, y: 1000, ...size });
    d.items.set(frame.id, frame);
    for (const c of children) d.items.set(c.id, { ...c, parentId: "FR" });
    return { d, frame };
  };
  const boxOf = (d: BoardDomain, i: BoardItem, at: { x: number; y: number }) => {
    const e = itemExtent(d, i);
    return { x: at.x + e.dx, y: at.y + e.dy, w: e.width, h: e.height };
  };

  it("lands inside the frame, below its title, when the frame is empty", () => {
    const { d, frame } = frameWith([]);
    const note = item("N1", "NOTE", { x: -500, y: 3000 });
    d.items.set(note.id, note);
    const { at, grow } = spotInFrame(d, frame, note);
    expect(grow).toBeNull();
    expect(at.x).toBeGreaterThanOrEqual(FRAME_PADDING);
    expect(at.y).toBeGreaterThanOrEqual(FRAME_TITLE_HEIGHT);
    expect(at.x + 220).toBeLessThanOrEqual(640 - FRAME_PADDING);
  });

  it("keeps clear of what is in the frame already", () => {
    const sibling = item("S1", "NOTE", { x: FRAME_PADDING, y: FRAME_TITLE_HEIGHT + FRAME_PADDING / 2 });
    const { d, frame } = frameWith([sibling]);
    const note = item("N1", "NOTE");
    d.items.set(note.id, note);
    const { at, grow } = spotInFrame(d, frame, note);
    expect(grow).toBeNull();
    expect(overlaps(boxOf(d, note, at), boxOf(d, sibling, { x: sibling.x!, y: sibling.y! }), 0)).toBe(false);
  });

  it("measures evidence with the findings around it", () => {
    const { d, frame } = frameWith([]);
    const ev = item("E1", "EVIDENCE");
    d.items.set(ev.id, ev);
    d.bubbles.set("E1", bubble("E1", Array.from({ length: 8 }, (_, i) => row(`g${i}`))));
    const { at } = spotInFrame(d, frame, ev);
    const box = boxOf(d, ev, at);
    expect(box.x).toBeGreaterThanOrEqual(FRAME_PADDING);
    expect(box.y).toBeGreaterThanOrEqual(FRAME_TITLE_HEIGHT);
  });

  it("goes below everything and grows the frame when it is full", () => {
    const big = item("S1", "NOTE", { x: 0, y: 0, width: 640, height: 400 });
    const { d, frame } = frameWith([big]);
    const note = item("N1", "NOTE");
    d.items.set(note.id, note);
    const { at, grow } = spotInFrame(d, frame, note);
    expect(at.y).toBeGreaterThanOrEqual(400 + FRAME_PADDING);
    expect(grow).not.toBeNull();
    expect(grow!.height).toBeGreaterThanOrEqual(at.y + 160 + FRAME_PADDING);
    expect(grow!.width).toBe(640);
  });
});

describe("evidence status", () => {
  const d = fixture();
  d.itemByAsset.set("asset-E", "E");
  const candidate = (kind: "asset" | "finding", id: string, assetId: string) => ({
    kind,
    id,
    assetId,
    assetName: "x",
    assetType: null,
    sourceType: null,
  });

  it("tells assets on the board from new ones", () => {
    expect(evidenceStatus(d, candidate("asset", "asset-E", "asset-E"))).toBe("onBoard");
    expect(evidenceStatus(d, candidate("asset", "asset-Z", "asset-Z"))).toBe("absent");
  });

  it("offers to attach a finding whose asset is on the board but that is not in the case", () => {
    expect(evidenceStatus(d, candidate("finding", "f1", "asset-E"))).toBe("onBoard");
    expect(evidenceStatus(d, candidate("finding", "u1", "asset-E"))).toBe("attachable");
    expect(evidenceStatus(d, candidate("finding", "q9", "asset-Z"))).toBe("absent");
  });
});

describe("ports", () => {
  it("attaches every projected edge from an output to an input", () => {
    const d = fixture();
    const v: ProjectionView = {
      lod: "full",
      readOnly: false,
      showSuggested: false,
      hiddenSuggestions: new Set(),
      showResolvedComments: false,
      showAllRows: new Set(),
      expandedUnattached: new Set(),
      edgeClasses: new Set(["FLOW", "IDENTITY", "REFERENCE"]),
    };
    const edges = projectEdges(d, v, projectNodes(d, v));
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.sourceHandle).toBe(SOURCE_PORT);
      expect(e.targetHandle).toBe(TARGET_PORT);
    }
  });
});
