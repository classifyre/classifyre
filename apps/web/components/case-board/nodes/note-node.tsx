"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { editText, resizeItem } from "../store/commands";
import type { BoardNode } from "../store/projection";
import { useLod } from "../hooks/use-lod";
import { Ports } from "./ports";

const NOTE_MIN = { width: 160, height: 100 };

/**
 * Sticky note (PRD §5.6): markdown text, a colour, resizable. Double-click to
 * edit; Escape or a click outside saves. The save carries the note's
 * `updatedAt`, so a stale edit is refused instead of overwriting someone
 * else's text.
 */
export const NoteNode = React.memo(function NoteNode({ id, selected }: NodeProps<BoardNode>) {
  const { t } = useTranslation();
  const item = useBoard((s) => s.items.get(id));
  const readOnly = useBoard((s) => s.readOnly);
  const editing = useUi((s) => s.editingItemId === id);
  const pulse = useUi((s) => s.pulse === id);
  const lod = useLod();
  const store = useBoardStore();
  const ui = useUiStore();
  const [draft, setDraft] = React.useState("");
  const areaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (editing && item) {
      setDraft(item.content.text ?? "");
      requestAnimationFrame(() => areaRef.current?.focus());
    }
    // Only when editing starts: typing must not be reset by a refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (!item) return null;
  const color = item.style.color ?? "yellow";
  const text = item.content.text ?? "";

  const commit = () => {
    ui.getState().set({ editingItemId: null });
    const current = store.getState().items.get(id);
    if (current && (current.content.text ?? "") !== draft) {
      store.getState().run(editText(current, draft));
    }
  };

  return (
    <>
      <NodeResizer
        isVisible={selected && !readOnly}
        minWidth={NOTE_MIN.width}
        minHeight={NOTE_MIN.height}
        lineClassName="!border-foreground"
        handleClassName="!size-2 !border-foreground !bg-background"
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
          `cb-note-${color}`,
          "flex h-full w-full flex-col overflow-hidden rounded-[4px] border-2 p-3 text-sm text-foreground",
          selected ? "border-foreground" : "border-border/70",
          item.style.highlight && `cb-ring-${item.style.highlight}`,
          pulse && "cb-pulse",
        )}
        aria-label={text ? text.slice(0, 80) : t("caseBoard.note.empty")}
        data-testid="note-node"
        onDoubleClick={() => {
          if (!readOnly) ui.getState().set({ editingItemId: id });
        }}
      >
        {editing ? (
          <textarea
            ref={areaRef}
            className="nodrag nowheel nopan h-full w-full resize-none bg-transparent font-sans text-sm leading-snug outline-none"
            value={draft}
            placeholder={t("caseBoard.note.placeholder")}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                commit();
              }
              e.stopPropagation();
            }}
          />
        ) : lod === "chip" ? (
          <p className="line-clamp-3 text-lg font-semibold">{text || t("caseBoard.note.empty")}</p>
        ) : text ? (
          <div className="cb-markdown nowheel min-h-0 flex-1 overflow-hidden leading-snug break-words">
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-muted-foreground italic">{t("caseBoard.note.placeholder")}</p>
        )}
      </div>
      <Ports connectable={!readOnly} />
    </>
  );
});
