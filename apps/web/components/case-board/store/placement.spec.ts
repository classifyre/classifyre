import { overlaps, type Rect } from "./geometry";
import { placeNearNeighbours, type PlaceRequest } from "./placement";

const box = (width = 200, height = 120) => ({ dx: 0, dy: 0, width, height });
const req = (id: string, b = box()): PlaceRequest => ({ id, box: b });

function graph(pairs: [string, string][]) {
  const out = new Map<string, string[]>();
  for (const [a, b] of pairs) {
    out.set(a, [...(out.get(a) ?? []), b]);
    out.set(b, [...(out.get(b) ?? []), a]);
  }
  return (id: string) => out.get(id) ?? [];
}

describe("placeNearNeighbours", () => {
  const hyp: Rect = { x: 0, y: 0, w: 300, h: 200 };
  const onBoard = (id: string) => (id === "H" ? hyp : undefined);

  it("grows a chain off the board instead of sending its far end to Incoming", () => {
    const { positions, orphans } = placeNearNeighbours({
      items: [req("C"), req("B")],
      rectOf: onBoard,
      neighbours: graph([
        ["H", "B"],
        ["B", "C"],
      ]),
      taken: [hyp],
      gap: 48,
    });
    expect(orphans).toEqual([]);
    const b = positions.get("B")!;
    const c = positions.get("C")!;
    // B sits by the hypothesis, C by B (not by the hypothesis).
    expect(Math.hypot(b.x - hyp.x, b.y - hyp.y)).toBeLessThan(Math.hypot(c.x - hyp.x, c.y - hyp.y));
    expect(Math.hypot(c.x - b.x, c.y - b.y)).toBeLessThan(600);
  });

  it("never overlaps anything, however many items share one anchor", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `E${i}`);
    const { positions, orphans } = placeNearNeighbours({
      items: ids.map((id) => req(id)),
      rectOf: onBoard,
      neighbours: graph(ids.map((id) => ["H", id] as [string, string])),
      taken: [hyp],
      gap: 48,
    });
    expect(orphans).toEqual([]);
    const rects: Rect[] = [hyp, ...ids.map((id) => ({ ...positions.get(id)!, w: 200, h: 120 }))];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) expect(overlaps(rects[i]!, rects[j]!, 0)).toBe(false);
    }
  });

  it("places the best-connected item first and leaves unconnected ones as orphans", () => {
    const { positions, orphans } = placeNearNeighbours({
      items: [req("LONE"), req("X")],
      rectOf: onBoard,
      neighbours: graph([["H", "X"]]),
      taken: [hyp],
      gap: 48,
    });
    expect([...positions.keys()]).toEqual(["X"]);
    expect(orphans.map((o) => o.id)).toEqual(["LONE"]);
  });

  it("returns item positions, not box positions, for evidence whose findings reach left and up", () => {
    const { positions } = placeNearNeighbours({
      items: [req("E", { dx: -80, dy: -40, width: 300, height: 200 })],
      rectOf: onBoard,
      neighbours: graph([["H", "E"]]),
      taken: [hyp],
      gap: 48,
    });
    const e = positions.get("E")!;
    const boxRect = { x: e.x - 80, y: e.y - 40, w: 300, h: 200 };
    expect(overlaps(boxRect, hyp, 0)).toBe(false);
  });
});
