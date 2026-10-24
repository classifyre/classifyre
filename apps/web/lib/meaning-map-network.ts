import {
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { MapLink, MapNode } from "@/lib/semantic-api";
import { CONCEPT_SIZE, frameIdOf, separateRects } from "./meaning-map-layout";

interface SimNode extends SimulationNodeDatum {
  id: string;
  anchor: { x: number; y: number };
}

type SimLink = SimulationLinkDatum<SimNode> & { kind: string; lift: number | null };

const GAP = 14;

/**
 * The network layout (SL5 B2): concepts that turn up on the same assets pull
 * together, each scheme keeps a home on a ring so its concepts stay a
 * neighbourhood, and cards never overlap. d3-force runs to rest here, on the
 * main thread: a glossary is hundreds of concepts, not tens of thousands.
 *
 * Returns each card's top-left corner.
 */
export function networkLayout(
  nodes: MapNode[],
  links: MapLink[],
): Map<string, { x: number; y: number }> {
  const groups = new Map<string, MapNode[]>();
  for (const node of nodes) {
    const id = frameIdOf(node.scheme);
    groups.set(id, [...(groups.get(id) ?? []), node]);
  }
  const ordered = [...groups.entries()].sort(
    (a, b) =>
      Math.max(...b[1].map((n) => n.totalAssetCount)) -
        Math.max(...a[1].map((n) => n.totalAssetCount)) || a[0].localeCompare(b[0]),
  );
  // Room for every card plus its share of space, as a disk.
  const area = nodes.length * (CONCEPT_SIZE.width + GAP) * (CONCEPT_SIZE.height + GAP * 2);
  const ring = ordered.length > 1 ? 0.55 * Math.sqrt(area / Math.PI) : 0;
  const anchors = new Map<string, { x: number; y: number }>();
  ordered.forEach(([id], index) => {
    const angle = (2 * Math.PI * index) / ordered.length - Math.PI / 2;
    anchors.set(id, { x: ring * Math.cos(angle) * 1.5, y: ring * Math.sin(angle) * 0.85 });
  });

  const simNodes: SimNode[] = [];
  for (const [id, members] of ordered) {
    const anchor = anchors.get(id)!;
    members.forEach((node, index) => {
      // A golden-angle spiral around the scheme's home: a calm start.
      const r = 30 * Math.sqrt(index);
      const theta = index * 2.399963;
      simNodes.push({
        id: node.termId,
        anchor,
        x: anchor.x + r * Math.cos(theta) * 1.6,
        y: anchor.y + r * Math.sin(theta),
      });
    });
  }
  const present = new Set(simNodes.map((node) => node.id));
  const lifts = links
    .filter((link) => link.kind === "CO_OCCURRENCE" && link.lift)
    .map((link) => Math.log(Math.max(1, link.lift ?? 1)));
  const maxLift = Math.max(1, ...lifts);
  const simLinks: SimLink[] = links
    .filter((link) => present.has(link.a) && present.has(link.b) && link.a !== link.b)
    .map((link) => ({ source: link.a, target: link.b, kind: link.kind, lift: link.lift }));

  const simulation = forceSimulation<SimNode>(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((node) => node.id)
        .distance((link) =>
          link.kind === "BROADER" ? 70 : link.kind === "CO_OCCURRENCE" ? 130 : 150,
        )
        .strength((link) =>
          link.kind === "BROADER"
            ? 0.5
            : link.kind === "CO_OCCURRENCE"
              ? 0.08 + (0.35 * Math.log(Math.max(1, link.lift ?? 1))) / maxLift
              : 0.2,
        ),
    )
    .force("charge", forceManyBody<SimNode>().strength(-120).distanceMax(500))
    .force("x", forceX<SimNode>((node) => node.anchor.x).strength(0.08))
    .force("y", forceY<SimNode>((node) => node.anchor.y).strength(0.12))
    .stop();
  const ticks = simNodes.length > 300 ? 160 : 300;
  for (let tick = 0; tick < ticks; tick += 1) {
    simulation.tick();
    // Cards are wide: keep them apart as rectangles, not as points.
    if (tick % 3 === 0) separateRects(simNodes as Array<{ x: number; y: number }>, CONCEPT_SIZE, GAP, 2);
  }
  separateRects(simNodes as Array<{ x: number; y: number }>, CONCEPT_SIZE, GAP);

  const minX = Math.min(...simNodes.map((node) => node.x ?? 0));
  const minY = Math.min(...simNodes.map((node) => node.y ?? 0));
  return new Map(
    simNodes.map((node) => [
      node.id,
      {
        x: Math.round((node.x ?? 0) - minX),
        y: Math.round((node.y ?? 0) - minY),
      },
    ]),
  );
}
