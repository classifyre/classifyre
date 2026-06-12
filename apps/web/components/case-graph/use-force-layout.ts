"use client";

import * as React from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import { collideRadius, keyOf, nodeKey, type SimEdge, type SimNode } from "./graph-types";
import { seedPosition } from "./graph-utils";

interface UseForceLayoutResult {
  /** Live node map (mutated by d3 every tick). Read positions from here. */
  simNodes: Map<string, SimNode>;
  /** Live edge list with resolved SimNode endpoints. */
  simEdges: SimEdge[];
  /** Monotonic counter bumped (rAF-throttled) on every simulation tick. */
  version: number;
  /** Fires once after the first simulation settles — used for zoom-to-fit. */
  onSettle: (cb: () => void) => void;
  dragStart: (key: string) => void;
  dragMove: (key: string, world: { x: number; y: number }) => void;
  dragEnd: (key: string) => void;
  /** Remove the fx/fy pin from a node and let physics reclaim it. */
  releasePin: (key: string) => void;
  isPinned: (key: string) => boolean;
  /** Gently reheat the simulation (e.g. after releasing a pin). */
  reheat: () => void;
}

export function useForceLayout(
  nodes: GraphNodeDto[],
  edges: GraphEdgeDto[],
  size: { width: number; height: number },
): UseForceLayoutResult {
  const simNodesRef = React.useRef<Map<string, SimNode>>(new Map());
  const simEdgesRef = React.useRef<SimEdge[]>([]);
  const simRef = React.useRef<Simulation<SimNode, SimEdge> | null>(null);
  const rafRef = React.useRef(0);
  const settleCbRef = React.useRef<(() => void) | null>(null);
  const [version, setVersion] = React.useState(0);

  // Re-run reconciliation only when the structure actually changes.
  const structure = React.useMemo(() => {
    const nodePart = nodes.map(keyOf).sort().join(",");
    const edgePart = edges.map((e) => e.id).sort().join(",");
    return `${nodePart}|${edgePart}`;
  }, [nodes, edges]);

  React.useEffect(() => {
    const prevMap = simNodesRef.current;
    const wasEmpty = prevMap.size === 0;
    const center = { x: size.width / 2 || 400, y: size.height / 2 || 300 };

    const next = new Map<string, SimNode>();
    for (const n of nodes) {
      const key = keyOf(n);
      const prev = prevMap.get(key);
      if (prev) {
        prev.data = n;
        next.set(key, prev);
      } else {
        const seed = seedPosition(n, edges, prevMap, center);
        next.set(key, { key, data: n, x: seed.x, y: seed.y });
      }
    }
    simNodesRef.current = next;

    const simNodes = Array.from(next.values());
    const simEdges: SimEdge[] = edges
      .filter(
        (e) => next.has(nodeKey(e.fromType, e.fromId)) && next.has(nodeKey(e.toType, e.toId)),
      )
      .map((e) => ({
        id: e.id,
        data: e,
        source: nodeKey(e.fromType, e.fromId),
        target: nodeKey(e.toType, e.toId),
      }));

    const sim = simRef.current ?? forceSimulation<SimNode>();
    simRef.current = sim;

    sim
      .nodes(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimEdge>(simEdges)
          .id((d) => d.key)
          .distance(110)
          .strength(0.4),
      )
      .force("charge", forceManyBody<SimNode>().strength(-420).distanceMax(600))
      .force(
        "collide",
        forceCollide<SimNode>((d) => collideRadius(d.data)).strength(0.9),
      )
      .force("x", forceX<SimNode>(center.x).strength(0.045))
      .force("y", forceY<SimNode>(center.y).strength(0.055))
      .on("tick", () => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => setVersion((v) => v + 1));
      })
      .on("end", () => {
        if (settleCbRef.current) {
          const cb = settleCbRef.current;
          settleCbRef.current = null;
          cb();
        }
      });

    // forceLink resolves string ids to SimNode references in place.
    simEdgesRef.current = simEdges;

    sim.alpha(wasEmpty ? 1 : 0.45).restart();
    setVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure, size.width, size.height]);

  React.useEffect(
    () => () => {
      simRef.current?.stop();
      cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const dragStart = React.useCallback((key: string) => {
    const node = simNodesRef.current.get(key);
    if (!node) return;
    simRef.current?.alphaTarget(0.25).restart();
    node.fx = node.x;
    node.fy = node.y;
  }, []);

  const dragMove = React.useCallback((key: string, world: { x: number; y: number }) => {
    const node = simNodesRef.current.get(key);
    if (!node) return;
    node.fx = world.x;
    node.fy = world.y;
  }, []);

  const dragEnd = React.useCallback((key: string) => {
    // Keep fx/fy set: dragged nodes stay pinned where the analyst placed them.
    void key;
    simRef.current?.alphaTarget(0);
  }, []);

  const releasePin = React.useCallback((key: string) => {
    const node = simNodesRef.current.get(key);
    if (!node) return;
    node.fx = null;
    node.fy = null;
    simRef.current?.alpha(0.3).restart();
  }, []);

  const isPinned = React.useCallback(
    (key: string) => {
      void version; // re-evaluate as the sim ticks
      const node = simNodesRef.current.get(key);
      return node?.fx != null;
    },
    [version],
  );

  const reheat = React.useCallback(() => {
    simRef.current?.alpha(0.5).restart();
  }, []);

  const onSettle = React.useCallback((cb: () => void) => {
    settleCbRef.current = cb;
  }, []);

  return {
    simNodes: simNodesRef.current,
    simEdges: simEdgesRef.current,
    version,
    onSettle,
    dragStart,
    dragMove,
    dragEnd,
    releasePin,
    isPinned,
    reheat,
  };
}
