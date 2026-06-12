"use client";

import * as React from "react";
import {
  Eye,
  EyeOff,
  GitBranch,
  Lightbulb,
  Maximize2,
  MousePointer2,
  Plus,
  RotateCcw,
  Route,
  Search,
  X,
} from "lucide-react";
import type { GraphMode, PathResult } from "./graph-types";

function ModeButton({
  active,
  onClick,
  icon,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 border-2 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:border-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ActionButton({
  onClick,
  icon,
  label,
  title,
  disabled,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label?: string;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex items-center gap-1.5 border-2 border-border bg-card px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-foreground transition-colors hover:border-foreground disabled:opacity-40"
    >
      {icon}
      {label}
    </button>
  );
}

export interface GraphToolbarProps {
  mode: GraphMode;
  onModeChange: (mode: GraphMode) => void;
  nodeCount: number;
  edgeCount: number;
  path: PathResult | null;
  onClearPath: () => void;
  onAddEvidence: () => void;
  onNewHypothesis: () => void;
  onZoomToFit: () => void;
  onReload: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  findingsVisible: boolean;
  onToggleFindings: () => void;
}

export function GraphToolbar({
  mode,
  onModeChange,
  nodeCount,
  edgeCount,
  path,
  onClearPath,
  onAddEvidence,
  onNewHypothesis,
  onZoomToFit,
  onReload,
  searchQuery,
  onSearchChange,
  findingsVisible,
  onToggleFindings,
}: GraphToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b-2 border-border bg-card px-3 py-2">
      <div className="flex items-center gap-1">
        <ModeButton
          active={mode.kind === "select"}
          onClick={() => onModeChange({ kind: "select" })}
          icon={<MousePointer2 className="h-3 w-3" />}
          label="Select"
          title="Select and drag nodes"
        />
        <ModeButton
          active={mode.kind === "connect"}
          onClick={() =>
            onModeChange(mode.kind === "connect" ? { kind: "select" } : { kind: "connect", sourceKey: null })
          }
          icon={<GitBranch className="h-3 w-3" />}
          label="Connect"
          title="Click a source node, then a target node, to create an edge"
        />
        <ModeButton
          active={mode.kind === "path"}
          onClick={() =>
            onModeChange(mode.kind === "path" ? { kind: "select" } : { kind: "path", firstKey: null })
          }
          icon={<Route className="h-3 w-3" />}
          label="Path"
          title="Click two nodes to highlight the path between them (or shift-click in select mode)"
        />
      </div>

      <div className="h-5 w-0.5 bg-border" />

      <ActionButton
        onClick={onAddEvidence}
        icon={<Plus className="h-3 w-3" />}
        label="Evidence"
        title="Add evidence to this case"
      />
      <ActionButton
        onClick={onNewHypothesis}
        icon={<Lightbulb className="h-3 w-3" />}
        label="Hypothesis"
        title="Create a new hypothesis"
      />

      <div className="h-5 w-0.5 bg-border" />

      {/* Full-text highlight search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="search graph…"
          className="h-[26px] w-[180px] border-2 border-border bg-card pr-6 font-mono text-[11px] outline-none placeholder:text-muted-foreground focus:border-foreground"
          style={{ paddingLeft: 24 }}
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <ModeButton
        active={findingsVisible}
        onClick={onToggleFindings}
        icon={findingsVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        label="Findings"
        title={findingsVisible ? "Collapse all findings into their assets" : "Show findings as separate nodes"}
      />

      {/* Mode hint / path chip */}
      <div className="min-w-0 flex-1 px-1">
        {path ? (
          <button
            onClick={onClearPath}
            className="inline-flex items-center gap-1.5 border-2 border-[#b7ff00] bg-[#b7ff00]/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide"
          >
            Path · {path.edgeIds.size} hop{path.edgeIds.size === 1 ? "" : "s"}
            <X className="h-3 w-3" />
          </button>
        ) : mode.kind === "connect" ? (
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {mode.sourceKey ? "now click the target node" : "click the source node"} · esc to cancel
          </span>
        ) : mode.kind === "path" ? (
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {mode.firstKey ? "click the destination node" : "click the start node"} · esc to cancel
          </span>
        ) : null}
      </div>

      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {nodeCount} nodes · {edgeCount} edges
      </span>
      <ActionButton onClick={onZoomToFit} icon={<Maximize2 className="h-3 w-3" />} title="Zoom to fit" />
      <ActionButton onClick={onReload} icon={<RotateCcw className="h-3 w-3" />} title="Reload graph" />
    </div>
  );
}
