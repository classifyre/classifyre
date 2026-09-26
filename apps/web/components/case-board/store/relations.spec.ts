import {
  ASSET_NODE,
  circleAnchor,
  defaultFindingSpot,
  evidenceExtent,
  FINDING_NODE,
  findingCode,
  findingNodeId,
  findingSpot,
  MAX_FINDING_NODES,
  parseFindingNodeId,
  ringRadius,
  severityMix,
  shownFindings,
} from "./relations";
import type { BubbleRow, SeverityKey } from "./types";

const row = (findingId: string, severity: SeverityKey | null = "medium"): BubbleRow => ({
  findingId,
  caseFindingId: `cf-${findingId}`,
  typeLabel: "email",
  value: null,
  severity,
  detector: null,
  status: "OPEN",
  matchState: null,
  missing: false,
  state: "open",
  note: null,
});

/** Centre of a finding node placed at `spot`, relative to the asset circle's centre. */
const fromAsset = (spot: { x: number; y: number }) => ({
  x: spot.x + FINDING_NODE.cx - ASSET_NODE.cx,
  y: spot.y + FINDING_NODE.cy - ASSET_NODE.cy,
});

describe("default finding spots", () => {
  it("fans a few findings out to the right of their asset", () => {
    for (const count of [1, 2, 3]) {
      for (let i = 0; i < count; i++) {
        const c = fromAsset(defaultFindingSpot(i, count));
        expect(c.x).toBeGreaterThan(0);
        expect(Math.hypot(c.x, c.y)).toBeCloseTo(ringRadius(count), -1);
      }
    }
    expect(fromAsset(defaultFindingSpot(0, 1)).y).toBeCloseTo(0, -1);
  });

  it("goes all the way round from 12 o'clock for four or more", () => {
    const top = fromAsset(defaultFindingSpot(0, 4));
    expect(top.x).toBeCloseTo(0, -1);
    expect(top.y).toBeLessThan(0);
    const spots = Array.from({ length: 8 }, (_, i) => fromAsset(defaultFindingSpot(i, 8)));
    expect(spots.some((c) => c.x < 0)).toBe(true);
    expect(spots.some((c) => c.y > 0)).toBe(true);
  });

  it("widens the ring so a dozen labels do not collide", () => {
    expect(ringRadius(12)).toBeGreaterThan(ringRadius(4));
    const a = fromAsset(defaultFindingSpot(0, 12));
    const b = fromAsset(defaultFindingSpot(1, 12));
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(90);
  });

  it("uses the spot the user dragged a finding to", () => {
    const item = { style: { findingPositions: { f1: { x: -300, y: 12 } } } };
    expect(findingSpot(item, "f1", 0, 3)).toEqual({ x: -300, y: 12 });
    expect(findingSpot(item, "f2", 1, 3)).toEqual(defaultFindingSpot(1, 3));
  });
});

describe("shownFindings", () => {
  it("shows up to a dozen attached findings, the rest folded behind ▸n", () => {
    const rows = Array.from({ length: MAX_FINDING_NODES + 5 }, (_, i) => row(`f${i}`));
    const shown = shownFindings({ rows, unattached: [] }, { showAll: false, showUnattached: false });
    expect(shown.nodes).toHaveLength(MAX_FINDING_NODES);
    expect(shown.folded).toBe(5);
    expect(shownFindings({ rows, unattached: [] }, { showAll: true, showUnattached: false }).folded).toBe(0);
  });

  it("appends the asset's other findings as ghosts only when asked", () => {
    const bubble = { rows: [row("a")], unattached: [row("u1"), row("u2")] };
    expect(shownFindings(bubble, { showAll: false, showUnattached: false }).nodes).toHaveLength(1);
    const shown = shownFindings(bubble, { showAll: false, showUnattached: true }).nodes;
    expect(shown.map((f) => [f.row.findingId, f.attached])).toEqual([
      ["a", true],
      ["u1", false],
      ["u2", false],
    ]);
  });
});

describe("evidenceExtent", () => {
  it("is the asset node alone when collapsed or without findings", () => {
    const box = { dx: 0, dy: 0, width: ASSET_NODE.width, height: ASSET_NODE.height };
    expect(evidenceExtent({ style: {}, collapsed: false }, { rows: [], unattached: [] })).toEqual(box);
    expect(evidenceExtent({ style: {}, collapsed: true }, { rows: [row("a"), row("b")], unattached: [] })).toEqual(box);
  });

  it("reaches around the asset to take in its findings", () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(`f${i}`));
    const ext = evidenceExtent({ style: {}, collapsed: false }, { rows, unattached: [] });
    expect(ext.dx).toBeLessThan(0);
    expect(ext.dy).toBeLessThan(0);
    expect(ext.width).toBeGreaterThan(ASSET_NODE.width);
    expect(ext.height).toBeGreaterThan(ASSET_NODE.height);
  });

  it("follows a finding the user dragged far away", () => {
    const ext = evidenceExtent(
      { style: { findingPositions: { a: { x: 900, y: 0 } } }, collapsed: false },
      { rows: [row("a")], unattached: [] },
    );
    expect(ext.dx + ext.width).toBe(900 + FINDING_NODE.width);
  });
});

describe("circleAnchor", () => {
  it("leaves the circle towards the other end", () => {
    expect(circleAnchor(0, 0, 10, { x: 100, y: 0 })).toMatchObject({ x: 10, y: 0, nx: 1, ny: 0 });
    const a = circleAnchor(0, 0, 10, { x: 0, y: -50 });
    expect(a.x).toBeCloseTo(0);
    expect(a.y).toBeCloseTo(-10);
  });

  it("has a direction even when both centres coincide", () => {
    expect(circleAnchor(5, 5, 10, { x: 5, y: 5 })).toMatchObject({ x: 15, y: 5 });
  });
});

describe("findingCode", () => {
  it("takes a custom detector's initials, as the old graph did", () => {
    expect(findingCode("Austrian company ID", "x")).toBe("ACI");
    expect(findingCode("Document kind", "x")).toBe("DK");
  });

  it("shortens a one-word detector type and falls back to the finding type", () => {
    expect(findingCode("REGEX", "x")).toBe("REG");
    expect(findingCode("PII", "x")).toBe("PII");
    expect(findingCode(null, "email address")).toBe("EA");
    expect(findingCode(null, "")).toBe("?");
  });
});

describe("severityMix", () => {
  it("counts per severity in severity order, a missing severity as info", () => {
    expect(severityMix([row("a", "low"), row("b", "critical"), row("c", null), row("d", "low")])).toEqual([
      { severity: "critical", count: 1 },
      { severity: "low", count: 2 },
      { severity: "info", count: 1 },
    ]);
  });
});

describe("finding node ids", () => {
  it("round-trips, even when a finding id contains colons", () => {
    const id = findingNodeId("0b9e3f0c-7f3c-4c1e-9d57-0f1f4c1e2a33", "src:doc:42");
    expect(parseFindingNodeId(id)).toEqual({
      itemId: "0b9e3f0c-7f3c-4c1e-9d57-0f1f4c1e2a33",
      findingId: "src:doc:42",
    });
    expect(parseFindingNodeId("0b9e3f0c-7f3c-4c1e-9d57-0f1f4c1e2a33")).toBeNull();
    expect(parseFindingNodeId("sg:asset")).toBeNull();
  });
});
