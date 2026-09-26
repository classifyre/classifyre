import type { ElkNode } from "elkjs/lib/elk-api";

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

type Pending = {
  resolve: (value: ElkNode) => void;
  reject: (reason: unknown) => void;
};

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./elk.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; result?: ElkNode; error?: string }>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if (event.data.error || !event.data.result) job.reject(new Error(event.data.error ?? "layout failed"));
      else job.resolve(event.data.result);
    };
    worker.onerror = () => {
      for (const job of pending.values()) job.reject(new Error("layout worker failed"));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

/**
 * A simple grid, used when no worker is available (tests, very old
 * browsers) or ELK fails: predictable beats nothing.
 */
export function gridLayout(nodes: LayoutNode[], origin = { x: 0, y: 0 }): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  let rowHeight = 0;
  let x = origin.x;
  let y = origin.y;
  nodes.forEach((n, i) => {
    if (i > 0 && i % columns === 0) {
      x = origin.x;
      y += rowHeight + 80;
      rowHeight = 0;
    }
    out.set(n.id, { x, y });
    x += n.width + 80;
    rowHeight = Math.max(rowHeight, n.height);
  });
  return out;
}

/**
 * "Tidy up" and the first layout of a board (PRD §8.9): ELK's layered
 * algorithm, left to right, with disconnected groups packed side by side.
 * Only ever runs on request — never continuously.
 */
export async function elkLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  origin = { x: 0, y: 0 },
): Promise<Map<string, { x: number; y: number }>> {
  if (nodes.length === 0) return new Map();
  const ids = new Set(nodes.map((n) => n.id));
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "140",
      "elk.spacing.componentComponent": "100",
      "elk.separateConnectedComponents": "true",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.aspectRatio": "1.8",
    },
    children: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
    edges: edges
      .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const toPositions = (result: ElkNode) => {
    const out = new Map<string, { x: number; y: number }>();
    for (const c of result.children ?? []) {
      out.set(c.id, { x: origin.x + (c.x ?? 0), y: origin.y + (c.y ?? 0) });
    }
    return out;
  };
  const w = getWorker();
  if (w) {
    const id = ++seq;
    try {
      const result = await new Promise<ElkNode>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ id, graph });
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error("layout timed out"));
        }, 15_000);
      });
      return toPositions(result);
    } catch {
      // Fall through to the main thread: a slower layout beats a grid.
    }
  }
  try {
    const mod = await import("elkjs/lib/elk.bundled.js");
    const ELK = (mod as unknown as { default: new () => { layout: (g: ElkNode) => Promise<ElkNode> } }).default;
    return toPositions(await new ELK().layout(graph));
  } catch {
    return gridLayout(nodes, origin);
  }
}
