import { useMemo, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import "@workspace/case-board/board.css";
import "./case-board.css";
import { EdgeMarkers } from "@workspace/case-board/components/markers";
import { buildFlow, type DemoScene } from "@workspace/case-board/demo";
import {
  ASSET_NODE,
  FINDING_NODE,
  FINDING_PORTS,
  roundPortHandles,
} from "@workspace/case-board/lib/geometry";
import {
  estimateHypothesisHeight,
  HYPOTHESIS_WIDTH,
} from "../../../../packages/schemas/src/case-board";
import { DEMO_EDGE_TYPES } from "../../../../packages/case-board/src/demo/demo-edges";
import { DEMO_NODE_TYPES } from "../../../../packages/case-board/src/demo/demo-nodes";

/*
 * The case board, filmed. The nodes and the lines are the board's own
 * (@workspace/case-board, the same ones apps/web and the docs draw); what a
 * film changes is who is in charge of the camera.
 *
 * React Flow moves its viewport in an effect, a frame late, and measures new
 * nodes with a ResizeObserver, later still: neither is a function of the
 * frame. So its own viewport never moves here: it draws the whole board once,
 * at life size, and the film pans and zooms that drawing; and every node says
 * how large it is (the board's nodes have fixed sizes), so nothing waits to
 * be measured.
 *
 * A board is described the way the documentation's demos describe theirs: a
 * `DemoScene` of assets, findings, hypotheses, notes and frames
 * (`@workspace/case-board/demo`).
 *
 * Imported by path (`src/kit/case-board`), not from the kit's index: it
 * brings React Flow with it.
 */

type FlowNode = ReturnType<typeof buildFlow>["nodes"][number];

/** The board coordinates the drawing covers. */
const WORLD = { x: -120, y: -150, w: 3120, h: 1180 } as const;

const ASSET_HANDLES = roundPortHandles({
  cx: ASSET_NODE.cx,
  cy: ASSET_NODE.cy,
  r: ASSET_NODE.ring,
});
const FINDING_HANDLES = roundPortHandles(FINDING_PORTS);

function boxHandles(width: number, height: number) {
  return roundPortHandles({
    cx: width / 2,
    cy: height / 2,
    r: 0,
    top: 0,
    bottom: height,
  }).map((handle) =>
    handle.id === "l"
      ? { ...handle, x: 0 }
      : handle.id === "r"
        ? { ...handle, x: width - (handle.width ?? 0) }
        : handle,
  );
}

/** A node that already knows its size and its ports: React Flow draws it at once. */
function sized(node: FlowNode): FlowNode {
  if (node.type === "asset") {
    const size = { width: ASSET_NODE.width, height: ASSET_NODE.height };
    return { ...node, ...size, measured: size, handles: ASSET_HANDLES };
  }
  if (node.type === "finding") {
    const size = { width: FINDING_NODE.width, height: FINDING_NODE.height };
    return { ...node, ...size, measured: size, handles: FINDING_HANDLES };
  }
  const item = node.data.node;
  const size =
    item.type === "hypothesis"
      ? {
          width: HYPOTHESIS_WIDTH,
          height: estimateHypothesisHeight(item.statement),
        }
      : {
          width: Number(node.style?.width ?? 220),
          height: Number(node.style?.height ?? 140),
        };
  return {
    ...node,
    measured: size,
    handles: boxHandles(size.width, size.height),
  };
}

export interface BoardCamera {
  /** The board point in the middle of the picture. */
  x: number;
  y: number;
  zoom: number;
}

export function FilmBoard({
  scene,
  camera,
  width,
  height,
  shown,
  linked,
  children,
}: {
  scene: DemoScene;
  camera: BoardCamera;
  width: number;
  height: number;
  /** 0 → 1 for a node that is arriving or leaving; 1 when it says nothing. */
  shown?: (id: string) => number;
  /** 0 → 1 for a hypothesis's line to a finding, as it is being drawn. */
  linked?: (findingId: string) => number;
  /** Drawn over the board, in board coordinates: the film's own labels. */
  children?: ReactNode;
}) {
  const flow = useMemo(() => {
    const built = buildFlow(scene);
    return { nodes: built.nodes.map(sized), edges: built.edges };
  }, [scene]);

  const nodes = flow.nodes.map((node) => {
    const visible = Math.min(
      shown?.(node.id) ?? 1,
      node.parentId ? (shown?.(node.parentId) ?? 1) : 1,
    );
    return visible >= 1
      ? node
      : {
          ...node,
          style: {
            ...node.style,
            opacity: visible,
            scale: String(0.55 + 0.45 * visible),
          },
        };
  });
  const parentOf = new Map(flow.nodes.map((node) => [node.id, node.parentId]));
  const edges = flow.edges.map((edge) => {
    const end = (id: string) =>
      Math.min(shown?.(id) ?? 1, shown?.(parentOf.get(id) ?? "") ?? 1);
    const drawn = edge.type === "stance" ? (linked?.(edge.target) ?? 1) : 1;
    const visible = Math.min(end(edge.source), end(edge.target), drawn);
    return visible >= 1
      ? edge
      : { ...edge, className: `film-fade-${Math.round(visible * 10)}` };
  });

  const far = camera.zoom < 0.55;
  return (
    <div
      className={`case-board relative overflow-hidden rounded-[4px] border border-border bg-background ${far ? "film-far" : ""}`}
      style={{ width, height }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: WORLD.w,
          height: WORLD.h,
          transform: `translate(${width / 2 - (camera.x - WORLD.x) * camera.zoom}px, ${height / 2 - (camera.y - WORLD.y) * camera.zoom}px) scale(${camera.zoom})`,
        }}
      >
        <ReactFlowProvider>
          <EdgeMarkers />
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={DEMO_NODE_TYPES}
            edgeTypes={DEMO_EDGE_TYPES}
            connectionMode={ConnectionMode.Loose}
            defaultViewport={{ x: -WORLD.x, y: -WORLD.y, zoom: 1 }}
            minZoom={1}
            maxZoom={1}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            deleteKeyCode={null}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          </ReactFlow>
        </ReactFlowProvider>
        <div
          className="pointer-events-none absolute"
          style={{ left: -WORLD.x, top: -WORLD.y }}
        >
          {children}
        </div>
      </div>
      {/* The library's credit, where the board shows it: in the corner of the picture. */}
      <span className="absolute bottom-0 right-0 bg-background/80 px-1 py-0.5 text-[10px] text-muted-foreground">
        React Flow
      </span>
    </div>
  );
}
