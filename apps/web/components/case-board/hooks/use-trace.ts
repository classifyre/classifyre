"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";
import { api, type BoardTraceNodeDto } from "@workspace/api-client";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { addEvidence, combine } from "../store/commands";
import { freeSpotNear, newEvidenceSize, takenRects } from "../store/geometry";
import { depthValue, TRACE_KINDS, TRACE_LIMIT, type TraceKind } from "../store/trace";
import type { UiStore, ViewPrefs } from "../store/ui-store";
import { useVisibleCentre } from "./use-visible-centre";

/** The kinds of relation the View draws and follows ("references" are links). */
export function viewKinds(view: Pick<ViewPrefs, "lineage" | "references" | "duplicates" | "similar">): TraceKind[] {
  const kinds: TraceKind[] = [];
  if (view.lineage) kinds.push("lineage");
  if (view.references) kinds.push("links");
  if (view.duplicates) kinds.push("duplicates");
  if (view.similar) kinds.push("similar");
  return kinds;
}

/**
 * "Show connections": walk from the traced asset whenever what is traced, or
 * how far, changes. Each change cancels the walk before it.
 */
export function useTraceLoader(caseId: string): void {
  const ui = useUiStore();
  const trace = useUi((s) => s.trace);
  const key = trace
    ? JSON.stringify([trace.seedAssetId, trace.direction, trace.depth, [...trace.kinds].sort(), trace.limit ?? TRACE_LIMIT])
    : "";

  React.useEffect(() => {
    const request = ui.getState().trace;
    if (!request) {
      ui.getState().set({ traceResult: null, traceLoading: false, traceError: null });
      return;
    }
    if (request.kinds.length === 0) {
      ui.getState().set({ traceResult: { nodes: [], edges: [], truncated: false }, traceLoading: false, traceError: null });
      return;
    }
    const controller = new AbortController();
    ui.getState().set({ traceLoading: true, traceError: null });
    const timer = window.setTimeout(() => {
      api.caseBoard
        .caseBoardControllerTrace(
          {
            id: caseId,
            boardTraceRequestDto: {
              assetIds: [request.seedAssetId],
              direction: request.direction,
              depth: depthValue(request.depth),
              kinds: request.kinds,
              limit: request.limit ?? TRACE_LIMIT,
            },
          },
          { signal: controller.signal },
        )
        .then((result) => {
          if (ui.getState().trace?.seedAssetId !== request.seedAssetId) return;
          ui.getState().set({ traceResult: result, traceLoading: false });
        })
        .catch(async (error: unknown) => {
          if (controller.signal.aborted) return;
          ui.getState().set({
            traceLoading: false,
            traceError: await extractApiErrorMessage(error, "The connections could not be traced."),
          });
        });
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, caseId, ui]);
}

/**
 * Neighbours beyond the first hop: when the View asks for two hops or more,
 * walk from every piece of evidence and hand the result to the board as
 * suggestions. One hop needs no walk — the board's own read has it.
 */
export function useNeighbourhoodLoader(caseId: string): void {
  const store = useBoardStore();
  const ui = useUiStore();
  const hops = useUi((s) => s.view.neighbourHops);
  const kinds = useUi((s) => viewKinds(s.view).join(","));
  const seeds = useBoard((s) =>
    [...new Set([...s.bubbles.values()].map((b) => b.assetId).filter((id) => id.length > 0))].sort().join(","),
  );

  React.useEffect(() => {
    if (hops < 2 || !seeds || !kinds) {
      store.getState().setNeighbourhood(null);
      ui.getState().set({ neighbourhoodLoading: false, neighbourhoodTruncated: false });
      return;
    }
    const controller = new AbortController();
    ui.getState().set({ neighbourhoodLoading: true });
    const timer = window.setTimeout(() => {
      api.caseBoard
        .caseBoardControllerTrace(
          {
            id: caseId,
            boardTraceRequestDto: {
              assetIds: seeds.split(",").slice(0, 500),
              direction: "both",
              depth: hops,
              kinds: kinds.split(",") as TraceKind[],
              limit: 200,
            },
          },
          { signal: controller.signal },
        )
        .then((result) => {
          store.getState().setNeighbourhood(result);
          ui.getState().set({ neighbourhoodLoading: false, neighbourhoodTruncated: result.truncated });
        })
        .catch(() => {
          if (!controller.signal.aborted) ui.getState().set({ neighbourhoodLoading: false });
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [caseId, hops, kinds, seeds, store, ui]);
}

/** Open "Show connections" on a node, keeping how far and what the last trace followed. */
export function startTrace(
  ui: UiStore,
  seed: { nodeId: string; assetId: string; label: string; position?: { x: number; y: number } },
): void {
  const prev = ui.getState().trace;
  ui.getState().openDrawer("connections");
  ui.getState().set({
    trace: {
      seedNodeId: seed.nodeId,
      seedAssetId: seed.assetId,
      seedLabel: seed.label,
      seedPosition: seed.position,
      direction: prev?.direction ?? "both",
      depth: prev?.depth ?? 2,
      kinds: prev?.kinds ?? [...TRACE_KINDS],
      limit: TRACE_LIMIT,
    },
  });
}

/**
 * Add assets a trace found to the case in one undoable step, each where its
 * ghost stands, so the trace's layout becomes the board's. Externals and
 * what is already in the case are skipped.
 */
export function useAddFromTrace() {
  const store = useBoardStore();
  const rf = useReactFlow();
  const centre = useVisibleCentre();
  return React.useCallback(
    (nodes: BoardTraceNodeDto[], label: string) => {
      const s = store.getState();
      const taken = takenRects(s);
      const cmds = [];
      for (const n of nodes) {
        if (n.type !== "asset" || n.missing || s.itemByAsset.has(n.id)) continue;
        let at = rf.getNode(`tr:${n.id}`)?.position ?? rf.getNode(`sg:${n.id}`)?.position ?? null;
        if (!at) {
          const c = centre();
          const size = newEvidenceSize();
          at = freeSpotNear({ x: c.x - size.width / 2, y: c.y - size.height / 2 }, size, taken);
          taken.push({ x: at.x, y: at.y, w: size.width, h: size.height });
        }
        cmds.push(
          addEvidence({ entityType: "asset", entityId: n.id }, at, {
            label: n.label,
            assetType: n.assetType ?? null,
            sourceType: n.sourceType ?? null,
          }),
        );
      }
      if (cmds.length > 0) s.run(combine(label, ...cmds));
      return cmds.length;
    },
    [store, rf, centre],
  );
}
