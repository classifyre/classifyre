"use client";

import * as React from "react";
import type { GraphNodeDto, ThreadResponseDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  GitBranch,
  Lightbulb,
  Network,
  Paperclip,
  Pin,
  Trash2,
} from "lucide-react";
import { SectionTitle } from "./graph-sidebar";
import { useTranslation } from "@/hooks/use-translation";

export interface NodeDetailPanelProps {
  node: GraphNodeDto;
  isEvidence: boolean;
  isPinned: boolean;
  attachableCount: number;
  /** Attached findings on this asset (collapsible). */
  attachedCount: number;
  isExpandedAsset: boolean;
  hypotheses: ThreadResponseDto[];
  hypothesisColors: Record<string, string>;
  expanding: boolean;
  onAddEvidence: () => void;
  onRemoveEvidence: () => void;
  onAttachFinding: () => void;
  onUnlinkFinding: () => void;
  onLinkHypothesis: () => void;
  onConnectFrom: () => void;
  onExpand: () => void;
  onToggleCollapse: () => void;
  onAttachFindingsDialog: () => void;
  onReleasePin: () => void;
  onOpenAsset: () => void;
  onOpenFinding: () => void;
}

export function NodeDetailPanel({
  node,
  isEvidence,
  isPinned,
  attachableCount,
  attachedCount,
  isExpandedAsset,
  hypotheses,
  hypothesisColors,
  expanding,
  onAddEvidence,
  onRemoveEvidence,
  onAttachFinding,
  onUnlinkFinding,
  onLinkHypothesis,
  onConnectFrom,
  onExpand,
  onToggleCollapse,
  onAttachFindingsDialog,
  onReleasePin,
  onOpenAsset,
  onOpenFinding,
}: NodeDetailPanelProps) {
  const { t } = useTranslation();
  const isFinding = node.type === "finding";
  const memberships = (node.hypothesisIds ?? [])
    .map((id) => hypotheses.find((h) => h.id === id))
    .filter((h): h is ThreadResponseDto => Boolean(h));

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <SectionTitle>{node.type}</SectionTitle>
          {isEvidence && (
            <span className="border border-[#b7ff00] bg-[#b7ff00]/15 px-1 font-mono text-[9px] font-bold uppercase tracking-wide">
              {t("caseGraph.nodeDetail.evidence")}
            </span>
          )}
          {isFinding && node.caseFindingId && (
            <span className="border border-[#b7ff00] bg-[#b7ff00]/15 px-1 font-mono text-[9px] font-bold uppercase tracking-wide">
              {t("caseGraph.nodeDetail.attached")}
            </span>
          )}
        </div>
        <p className="mt-1 break-words text-sm font-medium leading-snug">{node.label}</p>
        {node.missing && (
          <p className="mt-1 text-xs text-destructive">{t("caseGraph.nodeDetail.sourceGone")}</p>
        )}
      </div>

      <div className="space-y-1.5 text-xs">
        {node.severity && (
          <SeverityBadge severity={node.severity.toLowerCase() as never}>{node.severity}</SeverityBadge>
        )}
        {node.detectorType && (
          <p className="text-muted-foreground">
            {t("caseGraph.nodeDetail.detector")} · <span className="font-mono">{node.detectorType}</span>
          </p>
        )}
        {node.assetName && (
          <p className="text-muted-foreground">
            {t("caseGraph.nodeDetail.onAsset")} · <span className="text-foreground">{node.assetName}</span>
          </p>
        )}
        {(node.sourceType ?? node.assetType) && (
          <p className="text-muted-foreground">
            {t("caseGraph.nodeDetail.source")} · <span className="font-mono uppercase">{node.sourceType ?? node.assetType}</span>
          </p>
        )}
      </div>

      {node.matchedContent && (
        <div className="space-y-1">
          <SectionTitle>{t("caseGraph.nodeDetail.matchedContent")}</SectionTitle>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words border-2 border-border bg-muted/50 p-2 font-mono text-[10px] leading-relaxed">
            {node.matchedContent}
          </pre>
        </div>
      )}

      {memberships.length > 0 && (
        <div className="space-y-1.5">
          <SectionTitle>{t("caseGraph.nodeDetail.hypotheses")}</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {memberships.map((h) => (
              <span
                key={h.id}
                className="inline-flex max-w-full items-center gap-1.5 border border-border bg-card px-1.5 py-0.5 text-[10px]"
              >
                <span
                  className="h-2 w-2 shrink-0 border border-foreground/40"
                  style={{ background: hypothesisColors[h.id] ?? "#888" }}
                />
                <span className="truncate">{h.title}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <SectionTitle>{t("common.actions")}</SectionTitle>
        <div className="flex flex-col gap-1.5">
          {!isFinding && !isEvidence && (
            <Button size="sm" onClick={onAddEvidence}>
              <Paperclip className="h-3.5 w-3.5" /> {t("caseGraph.nodeDetail.addAsEvidence")}
            </Button>
          )}
          {isFinding && !node.caseFindingId && (
            <Button size="sm" onClick={onAttachFinding}>
              <Paperclip className="h-3.5 w-3.5" /> {t("caseGraph.nodeDetail.attachFinding")}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onLinkHypothesis}>
            <Lightbulb className="h-3.5 w-3.5" /> {t("caseGraph.nodeDetail.linkToHypothesis")}
          </Button>
          <Button size="sm" variant="outline" onClick={onConnectFrom}>
            <GitBranch className="h-3.5 w-3.5" /> {t("caseGraph.nodeDetail.connectFromHere")}
          </Button>
          {node.type === "asset" && attachedCount > 0 && (
            <Button size="sm" variant="outline" onClick={onToggleCollapse}>
              {isExpandedAsset ? (
                <ChevronsDownUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronsUpDown className="h-3.5 w-3.5" />
              )}
              {isExpandedAsset
                ? t("caseGraph.nodeDetail.collapseFindings", { count: String(attachedCount) })
                : t("caseGraph.nodeDetail.expandFindings", { count: String(attachedCount) })}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onExpand} disabled={expanding}>
            <Network className="h-3.5 w-3.5" /> {expanding ? t("caseGraph.nodeDetail.loading") : t("caseGraph.nodeDetail.loadRelated")}
          </Button>
          {node.type === "asset" && attachableCount > 0 && (
            <Button size="sm" variant="outline" onClick={onAttachFindingsDialog}>
              <Paperclip className="h-3.5 w-3.5" /> {t("caseGraph.nodeDetail.reviewUnattached", { count: String(attachableCount) })}
            </Button>
          )}
          {node.type === "asset" && (
            <Button size="sm" variant="outline" onClick={onOpenAsset}>
              <ExternalLink className="h-3.5 w-3.5" /> {t("caseGraph.nodeDetail.openAsset")}
            </Button>
          )}
          {isFinding && (
            <Button size="sm" variant="outline" onClick={onOpenFinding}>
              <ExternalLink className="h-3.5 w-3.5" /> {t("caseGraph.nodeDetail.openFinding")}
            </Button>
          )}
          {isPinned && (
            <Button size="sm" variant="outline" onClick={onReleasePin}>
              <Pin className="h-3.5 w-3.5" /> {t("caseGraph.nodeDetail.releasePin")}
            </Button>
          )}
          {!isFinding && isEvidence && (
            <Button size="sm" variant="outline" className="text-destructive" onClick={onRemoveEvidence}>
              <Trash2 className="h-3.5 w-3.5" /> {t("caseGraph.nodeDetail.removeFromEvidence")}
            </Button>
          )}
          {isFinding && node.caseFindingId && (
            <Button size="sm" variant="outline" className="text-destructive" onClick={onUnlinkFinding}>
              <Trash2 className="h-3.5 w-3.5" /> {t("caseGraph.nodeDetail.unlinkFinding")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
