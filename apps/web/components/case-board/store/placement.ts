/**
 * Placing new items next to what they connect to (PRD §8.9). The algorithm is
 * shared with the API, which places items for the MCP arrange tools, so a
 * board placed from an agent and one placed in the browser grow the same way.
 */
import type { LayoutEdge } from "../hooks/elk-layout";

export { placeNearNeighbours, type PlaceRequest } from "@workspace/schemas/case-board";

/**
 * One layout edge per related pair among `ids`. Every relation is listed from
 * both of its ends, and the opposite pairs this made cost the layout its
 * compactness (each pair is a cycle to break) and ELK its speed.
 */
export function pairEdges(ids: readonly string[], neighbours: (id: string) => readonly string[]): LayoutEdge[] {
  const within = new Set(ids);
  const seen = new Set<string>();
  const edges: LayoutEdge[] = [];
  for (const id of ids) {
    for (const other of neighbours(id)) {
      if (other === id || !within.has(other)) continue;
      const key = id < other ? `${id}|${other}` : `${other}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ id: `${id}->${other}`, source: id, target: other });
    }
  }
  return edges;
}
