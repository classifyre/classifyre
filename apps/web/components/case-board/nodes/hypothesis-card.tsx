"use client";

import * as React from "react";
import type { NodeProps } from "@xyflow/react";
import { formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import { api, getActorName } from "@workspace/api-client";
import { HypothesisCardView, type HypothesisStatus } from "@workspace/case-board/components/hypothesis-card";
import { useLod } from "@workspace/case-board/hooks/use-lod";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import type { BoardNode } from "../store/projection";
import { hypothesisMeta } from "../store/selectors";

/**
 * A hypothesis as a first-class card (PRD §5.5). Its statement edits through
 * a STATEMENT thread entry, and status/confidence only ever change through
 * entries in the drawer, so the append-only evolution log stays intact.
 * Clicking the card focuses its stance edges.
 */
export const HypothesisCard = React.memo(function HypothesisCard({
  id,
  selected,
}: NodeProps<BoardNode>) {
  const { t } = useTranslation();
  const item = useBoard((s) => s.items.get(id));
  const thread = useBoard((s) => (item?.refId ? s.threads.get(item.refId) : undefined));
  const threads = useBoard((s) => s.threads);
  const readOnly = useBoard((s) => s.readOnly);
  const focused = useUi((s) => s.focusHypothesisItemId === id);
  const pulse = useUi((s) => s.pulse === id);
  const lod = useLod();
  const store = useBoardStore();
  const ui = useUiStore();
  // Editing starts from the menu ("Edit statement") or the thread panel; a
  // double click opens the thread instead.
  const editRequested = useUi((s) => s.editingItemId === id);
  const [saving, setSaving] = React.useState(false);

  const meta = React.useMemo(() => hypothesisMeta(threads), [threads]);
  if (!item || !thread) return null;
  const m = meta.get(thread.id) ?? { label: "H", color: "#737373", index: 0 };
  const status = (thread.status ?? "PROPOSED") as HypothesisStatus;

  const editing = editRequested && !readOnly && !thread.pending;
  const stopEditing = () => {
    if (ui.getState().editingItemId === id) ui.getState().set({ editingItemId: null });
  };
  const saveStatement = async (draft: string) => {
    const body = draft.trim();
    stopEditing();
    if (!body || body === thread.title || thread.pending) return;
    setSaving(true);
    try {
      await api.threads.caseThreadsControllerAddEntry({
        id: thread.id,
        addThreadEntryDto: { entryType: "STATEMENT", body, author: getActorName() },
      });
      store.getState().refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <HypothesisCardView
      label={m.label}
      color={m.color}
      statement={thread.title}
      status={status}
      text={{
        status: t(`caseBoard.hypothesis.status.${status}`),
        confidence: t("caseBoard.hypothesis.confidence"),
        supports: t("caseBoard.link.supports"),
        contradicts: t("caseBoard.link.contradicts"),
        neutral: t("caseBoard.link.neutral"),
        openThread: t("caseBoard.hypothesis.openThread"),
      }}
      lod={lod}
      readOnly={readOnly}
      confidence={thread.confidence}
      counts={{
        supports: thread.supportingCount,
        contradicts: thread.contradictingCount,
        neutral: thread.neutralCount,
      }}
      entries={thread.entryCount}
      lastEntry={
        thread.lastEntryAt && thread.lastAuthor
          ? t("caseBoard.hypothesis.lastEntry", {
              name: thread.lastAuthor,
              when: formatDistanceToNowStrict(new Date(thread.lastEntryAt), { addSuffix: true }),
            })
          : null
      }
      selected={selected}
      focused={focused}
      pending={thread.pending}
      busy={saving}
      highlight={item.style.highlight ?? null}
      pulse={pulse}
      editor={
        editing ? (
          <StatementEditor
            initial={thread.title}
            placeholder={t("caseBoard.hypothesis.placeholder")}
            onSave={(draft) => void saveStatement(draft)}
            onCancel={stopEditing}
          />
        ) : null
      }
      onToggleFocus={() => ui.getState().set({ focusHypothesisItemId: focused ? null : id })}
      onOpenThread={() => ui.getState().openDrawer("thread", { threadId: thread.id })}
    />
  );
});

/** The statement being edited in place; its draft lives only while it is open. */
function StatementEditor({
  initial,
  placeholder,
  onSave,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  onSave: (draft: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = React.useState(initial);
  return (
    <textarea
      className="nodrag nowheel w-full resize-none rounded-[3px] border border-border bg-background p-1 text-sm leading-snug outline-none focus:border-foreground"
      rows={3}
      autoFocus
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onSave(draft)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onSave(draft);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}
