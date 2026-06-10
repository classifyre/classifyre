"use client";

import * as React from "react";
import type { GraphNodeDto, ThreadResponseDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import {
  ExternalLink,
  GitBranch,
  Lightbulb,
  Maximize2,
  Paperclip,
  Pin,
  Trash2,
} from "lucide-react";
import { SectionTitle } from "./graph-sidebar";

export interface NodeDetailPanelProps {
  node: GraphNodeDto;
  isEvidence: boolean;
  isPinned: boolean;
  attachableCount: number;
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
  onAttachFindingsDialog: () => void;
  onReleasePin: () => void;
  onOpenAsset: () => void;
}

export function NodeDetailPanel({
  node,
  isEvidence,
  isPinned,
  attachableCount,
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
  onAttachFindingsDialog,
  onReleasePin,
  onOpenAsset,
}: NodeDetailPanelProps) {
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
              evidence
            </span>
          )}
          {isFinding && node.caseFindingId && (
            <span className="border border-[#b7ff00] bg-[#b7ff00]/15 px-1 font-mono text-[9px] font-bold uppercase tracking-wide">
              attached
            </span>
          )}
        </div>
        <p className="mt-1 break-words text-sm font-medium leading-snug">{node.label}</p>
        {node.missing && (
          <p className="mt-1 text-xs text-destructive">Source record no longer exists.</p>
        )}
      </div>

      <div className="space-y-1.5 text-xs">
        {node.severity && (
          <SeverityBadge severity={node.severity.toLowerCase() as never}>{node.severity}</SeverityBadge>
        )}
        {node.detectorType && (
          <p className="text-muted-foreground">
            detector · <span className="font-mono">{node.detectorType}</span>
          </p>
        )}
        {node.assetName && (
          <p className="text-muted-foreground">
            on asset · <span className="text-foreground">{node.assetName}</span>
          </p>
        )}
        {(node.sourceType ?? node.assetType) && (
          <p className="text-muted-foreground">
            source · <span className="font-mono uppercase">{node.sourceType ?? node.assetType}</span>
          </p>
        )}
      </div>

      {node.matchedContent && (
        <div className="space-y-1">
          <SectionTitle>Matched content</SectionTitle>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words border-2 border-border bg-muted/50 p-2 font-mono text-[10px] leading-relaxed">
            {node.matchedContent}
          </pre>
        </div>
      )}

      {memberships.length > 0 && (
        <div className="space-y-1.5">
          <SectionTitle>Hypotheses</SectionTitle>
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
        <SectionTitle>Actions</SectionTitle>
        <div className="flex flex-col gap-1.5">
          {!isFinding && !isEvidence && (
            <Button size="sm" onClick={onAddEvidence}>
              <Paperclip className="h-3.5 w-3.5" /> Add as evidence
            </Button>
          )}
          {isFinding && !node.caseFindingId && (
            <Button size="sm" onClick={onAttachFinding}>
              <Paperclip className="h-3.5 w-3.5" /> Attach finding to case
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onLinkHypothesis}>
            <Lightbulb className="h-3.5 w-3.5" /> Link to hypothesis…
          </Button>
          <Button size="sm" variant="outline" onClick={onConnectFrom}>
            <GitBranch className="h-3.5 w-3.5" /> Connect from here
          </Button>
          <Button size="sm" variant="outline" onClick={onExpand} disabled={expanding}>
            <Maximize2 className="h-3.5 w-3.5" /> {expanding ? "Expanding…" : "Expand neighbors"}
          </Button>
          {node.type === "asset" && attachableCount > 0 && (
            <Button size="sm" variant="outline" onClick={onAttachFindingsDialog}>
              <Paperclip className="h-3.5 w-3.5" /> Review {attachableCount} unattached finding
              {attachableCount === 1 ? "" : "s"}
            </Button>
          )}
          {node.type === "asset" && (
            <Button size="sm" variant="outline" onClick={onOpenAsset}>
              <ExternalLink className="h-3.5 w-3.5" /> Open asset
            </Button>
          )}
          {isPinned && (
            <Button size="sm" variant="outline" onClick={onReleasePin}>
              <Pin className="h-3.5 w-3.5" /> Release pin
            </Button>
          )}
          {!isFinding && isEvidence && (
            <Button size="sm" variant="outline" className="text-destructive" onClick={onRemoveEvidence}>
              <Trash2 className="h-3.5 w-3.5" /> Remove from evidence
            </Button>
          )}
          {isFinding && node.caseFindingId && (
            <Button size="sm" variant="outline" className="text-destructive" onClick={onUnlinkFinding}>
              <Trash2 className="h-3.5 w-3.5" /> Unlink finding
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
