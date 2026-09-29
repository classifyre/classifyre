import type { ElkNode } from "elkjs/lib/elk-api";
import { layeredLayout } from "@workspace/schemas/case-board";

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

/**
 * ELK is given boards up to this size. Keeping the model order
 * (NODES_AND_EDGES) makes its crossing minimisation blow up on dense graphs:
 * 100 assets with 300 relations take under a second, 40 with 624 took 42 s,
 * and a 523-asset case (2,352 relations) had not finished after 8 minutes.
 * Bigger boards get the shared layered layout instead: the same columns (the
 * API's arrange tools use it), in milliseconds.
 */
export const ELK_MAX_NODES = 200;
export const ELK_MAX_EDGES = 200;
/** ELK gets this long in its worker; after that the shared layout takes over. */
const ELK_TIMEOUT_MS = 5_000;

type Pending = {
  resolve: (value: ElkNode) => void;
  reject: (reason: unknown) => void;
};

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

/** Stop the worker and fail what waits on it: a layout that overran is still running there. */
function dropWorker(reason: string): void {
  for (const job of pending.values()) job.reject(new Error(reason));
  pending.clear();
  worker?.terminate();
  worker = null;
}

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
    worker.onerror = () => dropWorker("layout worker failed");
    return worker;
  } catch {
    return null;
  }
}

/**
 * "Tidy up" and the first layout of a board (PRD §8.9): ELK's layered
 * algorithm, left to right, with disconnected groups packed side by side.
 * Only ever runs on request — never continuously. ELK runs in a worker only:
 * a big board is laid out by the shared layered layout, as is any board whose
 * ELK run fails or overruns. ELK on the main thread froze the page.
 */
export async function elkLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  origin = { x: 0, y: 0 },
): Promise<Map<string, { x: number; y: number }>> {
  if (nodes.length === 0) return new Map();
  const ids = new Set(nodes.map((n) => n.id));
  const usable = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  const shared = () => layeredLayout(nodes, usable, origin);
  const w = nodes.length <= ELK_MAX_NODES && usable.length <= ELK_MAX_EDGES ? getWorker() : null;
  if (!w) return shared();

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
    edges: usable.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const id = ++seq;
  try {
    const result = await new Promise<ElkNode>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, graph });
      setTimeout(() => {
        if (pending.has(id)) dropWorker("layout timed out");
      }, ELK_TIMEOUT_MS);
    });
    const out = new Map<string, { x: number; y: number }>();
    for (const c of result.children ?? []) {
      out.set(c.id, { x: origin.x + (c.x ?? 0), y: origin.y + (c.y ?? 0) });
    }
    return out;
  } catch {
    return shared();
  }
}
