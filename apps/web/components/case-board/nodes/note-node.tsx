"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { BOARD_NOTE_MAX_CHARS } from "@workspace/schemas/case-board";
import { NoteView } from "@workspace/case-board/components/note-node";
import { useLod } from "@workspace/case-board/hooks/use-lod";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { textClaim } from "../store/claims";
import { editText, resizeItem } from "../store/commands";
import type { BoardNode } from "../store/projection";

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
  // The text and version editing began from, to tell a save on top of
  // someone else's edit (refused) from an ordinary one.
  const editedFrom = React.useRef<{ text: string; updatedAt: string } | null>(null);
  const areaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (editing && item) {
      setDraft(item.content.text ?? "");
      editedFrom.current = { text: item.content.text ?? "", updatedAt: item.updatedAt };
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
      store.getState().run(editText(current, draft, textClaim(current, current.content.text, editedFrom.current)));
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
      <NoteView
        color={color}
        text={text}
        emptyLabel={t("caseBoard.note.empty")}
        placeholder={t("caseBoard.note.placeholder")}
        lod={lod}
        readOnly={readOnly}
        selected={selected}
        highlight={item.style.highlight ?? null}
        pulse={pulse}
        renderText={(markdown) => <ReactMarkdown>{markdown}</ReactMarkdown>}
        onDoubleClick={() => {
          if (!readOnly) ui.getState().set({ editingItemId: id });
        }}
        editor={
          editing ? (
            <textarea
              ref={areaRef}
              className="nodrag nowheel nopan h-full w-full resize-none bg-transparent font-sans text-sm leading-snug outline-none"
              value={draft}
              maxLength={BOARD_NOTE_MAX_CHARS}
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
          ) : null
        }
      />
    </>
  );
});
