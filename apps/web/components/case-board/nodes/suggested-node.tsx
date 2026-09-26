"use client";

import * as React from "react";
import { useReactFlow, type NodeProps } from "@xyflow/react";
import { AddButton, AssetNode } from "@workspace/case-board/components/asset-node";
import { useLod } from "@workspace/case-board/hooks/use-lod";
import { getAssetKindIcon } from "@/lib/asset-kind";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore } from "../store/board-context";
import { addEvidence } from "../store/commands";
import type { BoardNode, SuggestedNodeData } from "../store/projection";

/**
 * A neighbour of the evidence that is not in the case (D5), drawn like any
 * asset, as the old graph did, only without the lime "in the case" ring. "+"
 * adds it to the case where it stands.
 */
export const SuggestedNode = React.memo(function SuggestedNode({ id, data, selected }: NodeProps<BoardNode>) {
  const { t } = useTranslation();
  const key = (data as SuggestedNodeData).suggestedKey;
  const suggestion = useBoard((s) => s.suggested.get(key));
  const readOnly = useBoard((s) => s.readOnly);
  const store = useBoardStore();
  const rf = useReactFlow();
  const lod = useLod();
  if (!suggestion) return null;

  const add = () => {
    const node = rf.getNode(id);
    store.getState().run(
      addEvidence({ entityType: "asset", entityId: suggestion.assetId }, node ? node.position : null, {
        label: suggestion.label,
        assetType: suggestion.assetType,
        sourceType: suggestion.sourceType,
      }),
    );
  };

  const source = suggestion.sourceName ?? suggestion.sourceType;
  return (
    <AssetNode
      testId="suggested-node"
      label={suggestion.label}
      title={[suggestion.label, source, t("caseBoard.suggested.hint")].filter(Boolean).join(" · ")}
      Icon={getAssetKindIcon(suggestion.assetType)}
      lod={lod}
      inCase={false}
      selected={!!selected}
      readOnly={readOnly}
      linkable={false}
      action={
        !readOnly && lod !== "chip" ? <AddButton placement="top" title={t("caseBoard.suggested.add")} onClick={add} /> : null
      }
    />
  );
});
