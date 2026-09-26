"use client";

import * as React from "react";
import type { NodeProps } from "@xyflow/react";
import { AddButton, AssetNode } from "@workspace/case-board/components/asset-node";
import { useLod } from "@workspace/case-board/hooks/use-lod";
import { getAssetKindIcon } from "@/lib/asset-kind";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore } from "../store/board-context";
import { addEvidence } from "../store/commands";
import type { BoardNode } from "../store/projection";
import { isTraceData } from "../store/trace";

const SIDE_MARK = { up: "↑", down: "↓", side: "≈", seed: "" } as const;

/**
 * An asset "Show connections" reached that is not on the board: a dashed
 * ghost in the trace's columns, marked with how many hops away it is and on
 * which side, and a "+" that adds it to the case right where it stands.
 */
export const TraceNode = React.memo(function TraceNode({ data, selected, positionAbsoluteX, positionAbsoluteY }: NodeProps<BoardNode>) {
  const { t } = useTranslation();
  const store = useBoardStore();
  const readOnly = useBoard((s) => s.readOnly);
  const lod = useLod();
  if (!isTraceData(data)) return null;
  const add = () =>
    store.getState().run(
      addEvidence({ entityType: "asset", entityId: data.traceNodeId }, { x: positionAbsoluteX, y: positionAbsoluteY }, {
        label: data.label,
        assetType: data.assetType,
        sourceType: data.sourceType,
      }),
    );
  const one = data.depth === 1;
  const where =
    data.side === "up"
      ? one
        ? t("caseBoard.connections.hopsUpOne")
        : t("caseBoard.connections.hopsUp", { count: data.depth })
      : data.side === "down"
        ? one
          ? t("caseBoard.connections.hopsDownOne")
          : t("caseBoard.connections.hopsDown", { count: data.depth })
        : one
          ? t("caseBoard.connections.hopsSideOne")
          : t("caseBoard.connections.hopsSide", { count: data.depth });
  return (
    <AssetNode
      testId="trace-node"
      label={data.label}
      title={[data.label, data.sourceName ?? data.sourceType, where].filter(Boolean).join(" · ")}
      Icon={getAssetKindIcon(data.assetType)}
      lod={lod}
      inCase={false}
      ghost
      selected={!!selected}
      readOnly={readOnly}
      linkable={false}
      topRight={
        lod !== "chip"
          ? { text: `${SIDE_MARK[data.side]}${data.depth}`, title: where }
          : null
      }
      action={
        !readOnly && !data.external && lod !== "chip" ? (
          <AddButton placement="side" title={t("caseBoard.connections.add")} onClick={add} testId="trace-add" />
        ) : undefined
      }
    />
  );
});
