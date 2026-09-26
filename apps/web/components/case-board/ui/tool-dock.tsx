"use client";

import * as React from "react";
import {
  Frame,
  Hand,
  FlaskConical,
  Link2,
  MessageSquare,
  MousePointer2,
  Redo2,
  StickyNote,
  Undo2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { TranslationKey } from "@/i18n";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useUi, useUiStore } from "../store/board-context";
import type { Tool } from "../store/ui-store";

const TOOLS: Array<{ tool: Tool; icon: React.ElementType; label: TranslationKey; key: string; editing: boolean }> = [
  { tool: "select", icon: MousePointer2, label: "caseBoard.tools.select", key: "V", editing: false },
  { tool: "hand", icon: Hand, label: "caseBoard.tools.hand", key: "H", editing: false },
  { tool: "note", icon: StickyNote, label: "caseBoard.tools.note", key: "N", editing: true },
  { tool: "frame", icon: Frame, label: "caseBoard.tools.frame", key: "F", editing: true },
  { tool: "hypothesis", icon: FlaskConical, label: "caseBoard.tools.hypothesis", key: "T", editing: true },
  { tool: "comment", icon: MessageSquare, label: "caseBoard.tools.comment", key: "C", editing: true },
  { tool: "link", icon: Link2, label: "caseBoard.tools.link", key: "L", editing: true },
];

function DockButton({
  active,
  disabled,
  label,
  shortcut,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "flex size-9 items-center justify-center rounded-[4px] border-2 transition-colors disabled:opacity-40",
            active ? "border-foreground bg-foreground text-background" : "border-transparent hover:border-border",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {label}
        {shortcut && <kbd className="ml-2 font-mono text-[10px] opacity-70">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Bottom-centre tool dock (PRD §5.1): tools, then undo/redo. */
export function ToolDock() {
  const { t } = useTranslation();
  const tool = useUi((s) => s.tool);
  const ui = useUiStore();
  const readOnly = useBoard((s) => s.readOnly);
  const undoLabel = useBoard((s) => s.undoStack.at(-1)?.label ?? null);
  const redoLabel = useBoard((s) => s.redoStack.at(-1)?.label ?? null);
  const undo = useBoard((s) => s.undo);
  const redo = useBoard((s) => s.redo);

  return (
    <div
      className="flex items-center gap-0.5 rounded-[6px] border-2 border-border bg-card p-1"
      role="toolbar"
      aria-label={t("caseBoard.boardLabel")}
      data-testid="tool-dock"
    >
      {TOOLS.map(({ tool: value, icon: Icon, label, key, editing }) => (
        <DockButton
          key={value}
          active={tool === value}
          disabled={readOnly && editing}
          label={t(label)}
          shortcut={key}
          onClick={() => ui.getState().setTool(value)}
        >
          <Icon className="size-4" aria-hidden />
        </DockButton>
      ))}
      <span className="mx-1 h-6 w-px bg-border" aria-hidden />
      <DockButton
        disabled={readOnly || !undoLabel}
        label={undoLabel ? t("caseBoard.tools.undoLabel", { label: undoLabel }) : t("caseBoard.tools.undo")}
        shortcut="⌘Z"
        onClick={undo}
      >
        <Undo2 className="size-4" aria-hidden />
      </DockButton>
      <DockButton
        disabled={readOnly || !redoLabel}
        label={redoLabel ? t("caseBoard.tools.redoLabel", { label: redoLabel }) : t("caseBoard.tools.redo")}
        shortcut="⇧⌘Z"
        onClick={redo}
      >
        <Redo2 className="size-4" aria-hidden />
      </DockButton>
    </div>
  );
}
