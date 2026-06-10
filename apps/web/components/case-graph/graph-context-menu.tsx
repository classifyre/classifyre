"use client";

import * as React from "react";
import type { GraphEdgeDto, GraphNodeDto, ThreadResponseDto } from "@workspace/api-client";
import { LinkThreadSupportDtoStanceEnum } from "@workspace/api-client";
import {
  ChevronRight,
  ExternalLink,
  GitBranch,
  Lightbulb,
  Maximize2,
  Paperclip,
  Pin,
  Route,
} from "lucide-react";

export type ContextMenuTarget =
  | { kind: "node"; node: GraphNodeDto }
  | { kind: "edge"; edge: GraphEdgeDto };

export interface ContextMenuState {
  x: number;
  y: number;
  target: ContextMenuTarget;
}

type Stance = LinkThreadSupportDtoStanceEnum;

export interface GraphContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
  // node context
  isEvidence: (node: GraphNodeDto) => boolean;
  isPinned: (node: GraphNodeDto) => boolean;
  attachableCount: (node: GraphNodeDto) => number;
  hypotheses: ThreadResponseDto[];
  hypothesisColors: Record<string, string>;
  onAddEvidence: (node: GraphNodeDto) => void;
  onRemoveEvidence: (node: GraphNodeDto) => void;
  onAttachFinding: (node: GraphNodeDto) => void;
  onUnlinkFinding: (node: GraphNodeDto) => void;
  onQuickLinkHypothesis: (node: GraphNodeDto, threadId: string, stance: Stance) => void;
  onLinkHypothesisDialog: (node: GraphNodeDto) => void;
  onNewHypothesis: (node: GraphNodeDto) => void;
  onConnectFrom: (node: GraphNodeDto) => void;
  onPathFrom: (node: GraphNodeDto) => void;
  onExpand: (node: GraphNodeDto) => void;
  onAttachFindingsDialog: (node: GraphNodeDto) => void;
  onReleasePin: (node: GraphNodeDto) => void;
  onOpenAsset: (node: GraphNodeDto) => void;
  // edge context
  onRenameEdge: (edge: GraphEdgeDto) => void;
  onDeleteEdge: (edge: GraphEdgeDto) => void;
}

function MenuItem({
  onClick,
  children,
  destructive,
  icon,
}: {
  onClick: () => void;
  children: React.ReactNode;
  destructive?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted ${
        destructive ? "text-destructive" : ""
      }`}
      onClick={onClick}
    >
      {icon && <span className="text-muted-foreground">{icon}</span>}
      {children}
    </button>
  );
}

const STANCES: Array<{ stance: Stance; symbol: string; title: string; cls: string }> = [
  { stance: LinkThreadSupportDtoStanceEnum.Supports, symbol: "✓", title: "Supports", cls: "hover:bg-green-600 hover:text-white" },
  { stance: LinkThreadSupportDtoStanceEnum.Contradicts, symbol: "✗", title: "Contradicts", cls: "hover:bg-destructive hover:text-white" },
  { stance: LinkThreadSupportDtoStanceEnum.Neutral, symbol: "○", title: "Neutral", cls: "hover:bg-foreground hover:text-background" },
];

export function GraphContextMenu(props: GraphContextMenuProps) {
  const { menu, onClose } = props;
  const ref = React.useRef<HTMLDivElement>(null);
  const [hypsOpen, setHypsOpen] = React.useState(false);

  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Clamp into the viewport.
  const style: React.CSSProperties = {
    left: Math.min(menu.x, typeof window !== "undefined" ? window.innerWidth - 280 : menu.x),
    top: Math.min(menu.y, typeof window !== "undefined" ? window.innerHeight - 360 : menu.y),
  };

  const close = (fn: () => void) => () => {
    fn();
    onClose();
  };

  if (menu.target.kind === "edge") {
    const edge = menu.target.edge;
    const manual = edge.origin === "MANUAL";
    return (
      <div
        ref={ref}
        style={style}
        className="fixed z-50 min-w-[220px] border-2 border-border bg-popover py-1 text-sm shadow-[4px_4px_0_0_var(--color-border)]"
      >
        <div className="mb-1 border-b-2 border-border px-3 py-1.5">
          <span className="block font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {edge.origin} edge
          </span>
          <span className="font-medium lowercase">{edge.relationType}</span>
        </div>
        {manual ? (
          <>
            <MenuItem onClick={close(() => props.onRenameEdge(edge))}>Rename relation…</MenuItem>
            <MenuItem destructive onClick={close(() => props.onDeleteEdge(edge))}>
              Delete edge
            </MenuItem>
          </>
        ) : (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            Inferred edges are auto-generated and read-only. Create a manual edge instead.
          </div>
        )}
      </div>
    );
  }

  const node = menu.target.node;
  const evidence = props.isEvidence(node);
  const isFinding = node.type === "finding";
  const attachable = props.attachableCount(node);

  return (
    <div
      ref={ref}
      style={style}
      className="fixed z-50 min-w-[240px] border-2 border-border bg-popover py-1 text-sm shadow-[4px_4px_0_0_var(--color-border)]"
    >
      <div className="mb-1 border-b-2 border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {node.type} · <span className="text-foreground">{node.label.slice(0, 32)}</span>
      </div>

      {/* Evidence membership */}
      {!isFinding && !evidence && (
        <MenuItem icon={<Paperclip className="h-3.5 w-3.5" />} onClick={close(() => props.onAddEvidence(node))}>
          Add as evidence
        </MenuItem>
      )}
      {!isFinding && evidence && (
        <MenuItem destructive icon={<Paperclip className="h-3.5 w-3.5" />} onClick={close(() => props.onRemoveEvidence(node))}>
          Remove from evidence
        </MenuItem>
      )}
      {isFinding && !node.caseFindingId && (
        <MenuItem icon={<Paperclip className="h-3.5 w-3.5" />} onClick={close(() => props.onAttachFinding(node))}>
          Attach finding to case
        </MenuItem>
      )}
      {isFinding && node.caseFindingId && (
        <MenuItem destructive icon={<Paperclip className="h-3.5 w-3.5" />} onClick={close(() => props.onUnlinkFinding(node))}>
          Unlink finding from case
        </MenuItem>
      )}

      {/* Hypotheses */}
      <button
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted"
        onClick={() => setHypsOpen((v) => !v)}
      >
        <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />
        Link to hypothesis
        <ChevronRight className={`ml-auto h-3.5 w-3.5 transition-transform ${hypsOpen ? "rotate-90" : ""}`} />
      </button>
      {hypsOpen && (
        <div className="border-y border-border bg-muted/40 py-0.5">
          {props.hypotheses.length === 0 && (
            <p className="px-3 py-1.5 text-xs text-muted-foreground">No hypotheses yet.</p>
          )}
          {props.hypotheses.map((h) => (
            <div key={h.id} className="flex items-center gap-2 px-3 py-1">
              <span
                className="h-2.5 w-2.5 shrink-0 border border-foreground/30"
                style={{ background: props.hypothesisColors[h.id] ?? "#888" }}
              />
              <span className="min-w-0 flex-1 truncate text-xs">{h.title}</span>
              {STANCES.map(({ stance, symbol, title, cls }) => (
                <button
                  key={stance}
                  title={`${title}: ${h.title}`}
                  className={`h-5 w-5 border border-border font-mono text-[10px] leading-none transition-colors ${cls}`}
                  onClick={close(() => props.onQuickLinkHypothesis(node, h.id, stance))}
                >
                  {symbol}
                </button>
              ))}
            </div>
          ))}
          <MenuItem onClick={close(() => props.onLinkHypothesisDialog(node))}>
            <span className="text-xs text-muted-foreground">Link with note…</span>
          </MenuItem>
          <MenuItem onClick={close(() => props.onNewHypothesis(node))}>
            <span className="text-xs text-muted-foreground">+ New hypothesis from this node…</span>
          </MenuItem>
        </div>
      )}

      {/* Graph actions */}
      <MenuItem icon={<GitBranch className="h-3.5 w-3.5" />} onClick={close(() => props.onConnectFrom(node))}>
        Connect from here
      </MenuItem>
      <MenuItem icon={<Route className="h-3.5 w-3.5" />} onClick={close(() => props.onPathFrom(node))}>
        Find path from here
      </MenuItem>
      <MenuItem icon={<Maximize2 className="h-3.5 w-3.5" />} onClick={close(() => props.onExpand(node))}>
        Expand neighbors
      </MenuItem>
      {node.type === "asset" && attachable > 0 && (
        <MenuItem icon={<Paperclip className="h-3.5 w-3.5" />} onClick={close(() => props.onAttachFindingsDialog(node))}>
          Review {attachable} unattached finding{attachable === 1 ? "" : "s"}…
        </MenuItem>
      )}
      {props.isPinned(node) && (
        <MenuItem icon={<Pin className="h-3.5 w-3.5" />} onClick={close(() => props.onReleasePin(node))}>
          Release pin
        </MenuItem>
      )}
      {node.type === "asset" && (
        <MenuItem icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={close(() => props.onOpenAsset(node))}>
          Open asset
        </MenuItem>
      )}
    </div>
  );
}
