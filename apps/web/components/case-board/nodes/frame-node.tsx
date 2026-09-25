"use client";

import * as React from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { editText, resizeItem, setCollapsed } from "../store/commands";
import { FRAME_TITLE_HEIGHT, type BoardNode } from "../store/projection";

const FRAME_MIN = { width: 240, height: 140 };

/**
 * A named, tinted group (PRD §5.6). Items dropped inside move with it. The
 * body lets pointer events through (see `.cb-frame-node` in case-board.css)
 * so a selection box can start inside a frame; only the title bar drags.
 */
export const FrameNode = React.memo(function FrameNode({ id, selected }: NodeProps<BoardNode>) {
  const { t } = useTranslation();
  const item = useBoard((s) => s.items.get(id));
  const members = useBoard((s) => {
    let n = 0;
    for (const i of s.items.values()) if (i.parentId === id) n += 1;
    return n;
  });
  const readOnly = useBoard((s) => s.readOnly);
  const editing = useUi((s) => s.editingItemId === id);
  const store = useBoardStore();
  const ui = useUiStore();
  const [draft, setDraft] = React.useState("");

  React.useEffect(() => {
    if (editing && item) setDraft(item.content.title ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (!item) return null;
  const tint = item.style.color ?? "gray";
  const title = item.content.title ?? "";

  const commit = () => {
    ui.getState().set({ editingItemId: null });
    const current = store.getState().items.get(id);
    if (current && (current.content.title ?? "") !== draft.trim()) {
      store.getState().run(editText(current, draft.trim()));
    }
  };

  return (
    <>
      <NodeResizer
        isVisible={selected && !readOnly && !item.collapsed}
        minWidth={FRAME_MIN.width}
        minHeight={FRAME_MIN.height}
        lineClassName="!border-foreground"
        handleClassName="!size-2.5 !border-foreground !bg-background"
        onResizeEnd={(_, params) => {
          const current = store.getState().items.get(id);
          if (!current) return;
          store.getState().run(
            resizeItem(current, {
              x: Math.round(params.x),
              y: Math.round(params.y),
              width: Math.round(params.width),
              height: Math.round(params.height),
            }),
          );
        }}
      />
      <div
        className={cn(
          `cb-frame-${tint}`,
          "h-full w-full rounded-[4px] border-2 border-dashed",
          selected ? "border-foreground" : "border-border/60",
          item.style.highlight && `cb-ring-${item.style.highlight}`,
        )}
        aria-label={title || t("caseBoard.frame.untitled")}
        data-testid="frame-node"
      >
        <div
          className="frame-drag pointer-events-auto flex cursor-grab items-center gap-2 px-3 active:cursor-grabbing"
          style={{ height: FRAME_TITLE_HEIGHT - 4 }}
          onDoubleClick={() => {
            if (!readOnly) ui.getState().set({ editingItemId: id });
          }}
        >
          <button
            type="button"
            className="nodrag -ml-1 rounded-[3px] p-0.5 hover:bg-muted"
            aria-label={item.collapsed ? t("caseBoard.frame.expand") : t("caseBoard.frame.collapse")}
            title={item.collapsed ? t("caseBoard.frame.expand") : t("caseBoard.frame.collapse")}
            disabled={readOnly}
            onClick={() => store.getState().run(setCollapsed(item, !item.collapsed))}
          >
            <ChevronDown className={cn("size-4 transition-transform", item.collapsed && "-rotate-90")} />
          </button>
          {editing ? (
            <input
              className="nodrag min-w-0 flex-1 rounded-[3px] border border-border bg-background px-1 font-serif text-sm font-bold uppercase tracking-[0.03em] outline-none focus:border-foreground"
              autoFocus
              value={draft}
              placeholder={t("caseBoard.frame.untitled")}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  e.preventDefault();
                  commit();
                }
                e.stopPropagation();
              }}
            />
          ) : (
            <span className="min-w-0 flex-1 truncate font-serif text-sm font-black uppercase tracking-[0.03em]">
              {title || <span className="text-muted-foreground">{t("caseBoard.frame.untitled")}</span>}
            </span>
          )}
          {item.collapsed && members > 0 && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {t("caseBoard.frame.members", { count: members })}
            </span>
          )}
        </div>
      </div>
    </>
  );
});
