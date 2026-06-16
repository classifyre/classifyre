import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";

interface WorkerNode {
  key: string;
  x: number;
  y: number;
  collideR: number;
  fx?: number | null;
  fy?: number | null;
}

interface WorkerEdge {
  id: string;
  source: string;
  target: string;
}

type WorkerInMessage =
  | { type: "init"; nodes: WorkerNode[]; edges: WorkerEdge[]; center: { x: number; y: number }; alpha?: number }
  | { type: "drag-start"; key: string }
  | { type: "drag-move"; key: string; x: number; y: number }
  | { type: "drag-end"; key: string }
  | { type: "release-pin"; key: string }
  | { type: "reheat" };

interface TickResponse {
  type: "tick";
  positions: Array<{ key: string; x: number; y: number; fx?: number | null; fy?: number | null }>;
}

interface SettledResponse {
  type: "settled";
}

type WorkerOutMessage = TickResponse | SettledResponse;

let sim: Simulation<WorkerNode, WorkerEdge> | null = null;
let rafId: ReturnType<typeof setTimeout> | null = null;

const TICK_INTERVAL = 32; // ~30fps — fast enough for smooth animation

function startTickLoop() {
  stopTickLoop();
  const tick = () => {
    if (!sim) return;
    const nodes = sim.nodes() as WorkerNode[];
    const positions = nodes.map((n) => ({
      key: n.key,
      x: n.x,
      y: n.y,
      fx: n.fx,
      fy: n.fy,
    }));
    self.postMessage({ type: "tick", positions } satisfies TickResponse);
    if (sim.alpha() < sim.alphaMin()) {
      self.postMessage({ type: "settled" } satisfies SettledResponse);
      stopTickLoop();
      return;
    }
    rafId = setTimeout(tick, TICK_INTERVAL);
  };
  rafId = setTimeout(tick, TICK_INTERVAL);
}

function stopTickLoop() {
  if (rafId != null) {
    clearTimeout(rafId);
    rafId = null;
  }
}

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case "init": {
      stopTickLoop();
      if (sim) {
        sim.stop();
        sim = null;
      }

      const { nodes, edges, center, alpha } = msg;

      sim = forceSimulation<WorkerNode>(nodes)
        .force(
          "link",
          forceLink<WorkerNode, WorkerEdge>(edges)
            .id((d) => d.key)
            .distance(110)
            .strength(0.4),
        )
        .force("charge", forceManyBody<WorkerNode>().strength(-420).distanceMax(600))
        .force(
          "collide",
          forceCollide<WorkerNode>((d) => d.collideR).strength(0.9),
        )
        .force("x", forceX<WorkerNode>(center.x).strength(0.045))
        .force("y", forceY<WorkerNode>(center.y).strength(0.055))
        .alpha(alpha ?? 0.45);

      startTickLoop();
      break;
    }

    case "drag-start": {
      const node = sim?.nodes().find((n) => n.key === msg.key);
      if (node) {
        sim?.alphaTarget(0.25).restart();
        node.fx = node.x;
        node.fy = node.y;
        startTickLoop();
      }
      break;
    }

    case "drag-move": {
      const node = sim?.nodes().find((n) => n.key === msg.key);
      if (node) {
        node.fx = msg.x;
        node.fy = msg.y;
      }
      break;
    }

    case "drag-end": {
      sim?.alphaTarget(0);
      break;
    }

    case "release-pin": {
      const node = sim?.nodes().find((n) => n.key === msg.key);
      if (node) {
        node.fx = null;
        node.fy = null;
        sim?.alpha(0.3).restart();
        startTickLoop();
      }
      break;
    }

    case "reheat": {
      sim?.alpha(0.5).restart();
      startTickLoop();
      break;
    }
  }
};
