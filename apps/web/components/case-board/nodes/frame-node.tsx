"use client";

import * as React from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { BOARD_FRAME_TITLE_MAX_CHARS } from "@workspace/schemas/case-board";
import { FrameView } from "@workspace/case-board/components/frame-node";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { textClaim } from "../store/claims";
import { editText, resizeItem, setCollapsed } from "../store/commands";
import type { BoardNode } from "../store/projection";

const FRAME_MIN = { width: 240, height: 140 };

/**
 * A named, tinted group (PRD §5.6). Items dropped inside move with it; only
 * the title bar drags. Double-click the title to rename it.
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
  // The title and version renaming began from (see textClaim).
  const editedFrom = React.useRef<{ text: string; updatedAt: string } | null>(null);

  React.useEffect(() => {
    if (editing && item) {
      setDraft(item.content.title ?? "");
      editedFrom.current = { text: item.content.title ?? "", updatedAt: item.updatedAt };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (!item) return null;
  const tint = item.style.color ?? "gray";
  const title = item.content.title ?? "";

  const commit = () => {
    ui.getState().set({ editingItemId: null });
    const current = store.getState().items.get(id);
    if (current && (current.content.title ?? "") !== draft.trim()) {
      store.getState().run(editText(current, draft.trim(), textClaim(current, current.content.title, editedFrom.current)));
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
      <FrameView
        tint={tint}
        title={title}
        untitledLabel={t("caseBoard.frame.untitled")}
        collapsed={item.collapsed}
        members={item.collapsed && members > 0 ? t("caseBoard.frame.members", { count: members }) : null}
        toggleLabel={item.collapsed ? t("caseBoard.frame.expand") : t("caseBoard.frame.collapse")}
        readOnly={readOnly}
        selected={selected}
        highlight={item.style.highlight ?? null}
        onToggle={() => store.getState().run(setCollapsed(item, !item.collapsed))}
        onTitleDoubleClick={() => {
          if (!readOnly) ui.getState().set({ editingItemId: id });
        }}
        editor={
          editing ? (
            <input
              className="nodrag min-w-0 flex-1 rounded-[3px] border border-border bg-background px-1 font-serif text-sm font-bold uppercase tracking-[0.03em] outline-none focus:border-foreground"
              autoFocus
              value={draft}
              maxLength={BOARD_FRAME_TITLE_MAX_CHARS}
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
          ) : null
        }
      />
    </>
  );
});
