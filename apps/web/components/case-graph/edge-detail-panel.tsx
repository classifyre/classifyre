"use client";

import * as React from "react";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Pencil, Trash2 } from "lucide-react";
import { SectionTitle } from "./graph-sidebar";
import { useTranslation } from "@/hooks/use-translation";

export interface EdgeDetailPanelProps {
  edge: GraphEdgeDto;
  fromNode: GraphNodeDto | undefined;
  toNode: GraphNodeDto | undefined;
  onSelectNode: (node: GraphNodeDto) => void;
  onRename: () => void;
  onDelete: () => void;
}

function EndpointButton({
  label,
  node,
  onClick,
}: {
  label: string;
  node: GraphNodeDto | undefined;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-9 shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {node ? (
        <button onClick={onClick} className="min-w-0 flex-1 truncate text-left text-xs underline-offset-2 hover:underline">
          <span className="mr-1 font-mono text-[9px] uppercase text-muted-foreground">{node.type}</span>
          {node.label}
        </button>
      ) : (
        <span className="text-xs text-muted-foreground">{t("caseGraph.edgeDetail.notInView")}</span>
      )}
    </div>
  );
}

export function EdgeDetailPanel({
  edge,
  fromNode,
  toNode,
  onSelectNode,
  onRename,
  onDelete,
}: EdgeDetailPanelProps) {
  const { t } = useTranslation();
  const manual = edge.origin === "MANUAL";
  return (
    <div className="space-y-4">
      <div>
        <SectionTitle>{t("caseGraph.edgeDetail.originLabel", { origin: edge.origin })}</SectionTitle>
        <p className="mt-1 font-mono text-sm font-medium lowercase">{edge.relationType}</p>
      </div>

      <div className="space-y-1.5">
        <EndpointButton label={t("caseGraph.edgeDetail.from")} node={fromNode} onClick={() => fromNode && onSelectNode(fromNode)} />
        <EndpointButton label={t("caseGraph.edgeDetail.to")} node={toNode} onClick={() => toNode && onSelectNode(toNode)} />
        {typeof edge.confidence === "number" && (
          <div className="flex items-baseline gap-2">
            <span className="w-9 shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              {t("caseGraph.edgeDetail.conf")}
            </span>
            <span className="font-mono text-xs tabular-nums">{Math.round(edge.confidence * 100)}%</span>
          </div>
        )}
      </div>

      {manual ? (
        <div className="flex flex-col gap-1.5">
          <Button size="sm" variant="outline" onClick={onRename}>
            <Pencil className="h-3.5 w-3.5" /> {t("caseGraph.edgeDetail.rename")}
          </Button>
          <Button size="sm" variant="outline" className="text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" /> {t("caseGraph.edgeDetail.delete")}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("caseGraph.edgeDetail.inferredReadOnly")}
        </p>
      )}
    </div>
  );
}
