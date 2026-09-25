"use client";

import * as React from "react";
import { useReactFlow, type NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";
import { getAssetKindIcon } from "@/lib/asset-kind";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore } from "../store/board-context";
import { addEvidence } from "../store/commands";
import type { BoardNode, SuggestedNodeData } from "../store/projection";
import { ASSET_NODE } from "../store/relations";
import { useLod } from "../hooks/use-lod";
import { AssetNode } from "./asset-node";

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
        !readOnly && lod !== "chip" ? (
          <button
            type="button"
            className="cb-add nodrag nopan absolute flex size-[18px] items-center justify-center rounded-full border-[1.5px] border-[#0a0a0a] bg-accent text-accent-foreground"
            style={{ left: ASSET_NODE.cx + 12, top: ASSET_NODE.cy - ASSET_NODE.ring - 2 }}
            onClick={add}
            title={t("caseBoard.suggested.add")}
            aria-label={t("caseBoard.suggested.add")}
          >
            <Plus className="size-3" strokeWidth={3} aria-hidden />
          </button>
        ) : null
      }
    />
  );
});
