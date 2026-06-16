"use client";

import * as React from "react";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import { collideRadius, keyOf, nodeKey, type SimEdge, type SimNode } from "./graph-types";
import { seedPosition } from "./graph-utils";

interface UseForceLayoutResult {
  /** Live node map (updated by worker on every tick). Read positions from here. */
  simNodes: Map<string, SimNode>;
  /** Edge list mirroring the input edges. */
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
  const workerRef = React.useRef<Worker | null>(null);
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

    // Reconcile SimNode objects on the main thread (preserve existing positions).
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
    simEdgesRef.current = simEdges;

    // Build minimal payload for the worker (keys, initial positions, collision radii).
    const workerNodes = Array.from(next.values()).map((sn) => ({
      key: sn.key,
      x: sn.x,
      y: sn.y,
      collideR: collideRadius(sn.data),
    }));
    const workerEdges = simEdges.map((e) => ({
      id: e.id,
      source: e.source as string,
      target: e.target as string,
    }));

    // Spawn worker. Terminate previous if this is a restructure.
    workerRef.current?.terminate();
    const worker = new Worker(new URL("./force-worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "tick") {
        const map = simNodesRef.current;
        for (const p of msg.positions as Array<{
          key: string;
          x: number;
          y: number;
          fx?: number | null;
          fy?: number | null;
        }>) {
          const sn = map.get(p.key);
          if (sn) {
            sn.x = p.x;
            sn.y = p.y;
            sn.fx = p.fx ?? null;
            sn.fy = p.fy ?? null;
          }
        }
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => setVersion((v) => v + 1));
      } else if (msg.type === "settled") {
        if (settleCbRef.current) {
          const cb = settleCbRef.current;
          settleCbRef.current = null;
          cb();
        }
      }
    };

    worker.postMessage({ type: "init", nodes: workerNodes, edges: workerEdges, center, alpha: wasEmpty ? 1 : 0.45 });

    setVersion((v) => v + 1);

    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure, size.width, size.height]);

  React.useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const dragStart = React.useCallback((key: string) => {
    workerRef.current?.postMessage({ type: "drag-start", key });
  }, []);

  const dragMove = React.useCallback((key: string, world: { x: number; y: number }) => {
    workerRef.current?.postMessage({ type: "drag-move", key, x: world.x, y: world.y });
  }, []);

  const dragEnd = React.useCallback((key: string) => {
    workerRef.current?.postMessage({ type: "drag-end", key });
  }, []);

  const releasePin = React.useCallback((key: string) => {
    workerRef.current?.postMessage({ type: "release-pin", key });
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
    workerRef.current?.postMessage({ type: "reheat" });
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
