"use client";

import * as React from "react";
import type { NodeProps } from "@xyflow/react";
import { formatDistanceToNowStrict } from "date-fns";
import { Check, ChevronRight, Circle, Loader2, MessageSquare, X } from "lucide-react";
import { toast } from "sonner";
import { api, getActorName } from "@workspace/api-client";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import type { BoardNode } from "../store/projection";
import { hypothesisMeta } from "../store/selectors";
import { useLod } from "../hooks/use-lod";
import { StateChip, type ChipTone } from "../ui/state-chip";
import { Ports } from "./ports";

const STATUS_TONE: Record<string, ChipTone> = {
  PROPOSED: "muted",
  SUPPORTED: "success",
  REFUTED: "destructive",
  INCONCLUSIVE: "fresh",
};

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
  const status = thread.status ?? "PROPOSED";
  const highlight = item.style.highlight;

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

  if (lod === "chip") {
    return (
      <div
        className={cn(
          "relative flex w-[300px] items-center gap-2 rounded-[4px] border-2 bg-card px-3 py-3 text-base font-semibold",
          selected ? "border-foreground" : "border-border",
        )}
        style={{ borderLeft: `8px solid ${m.color}` }}
        aria-label={`${m.label}: ${thread.title}`}
      >
        <span className="font-mono">{m.label}</span>
        <span className="min-w-0 flex-1 truncate">{thread.title}</span>
        <Ports connectable={!readOnly} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative w-[300px] rounded-[4px] border-2 bg-card text-card-foreground",
        selected || focused ? "border-foreground" : "border-border",
        thread.pending && "opacity-70",
        highlight && `cb-ring-${highlight}`,
        pulse && "cb-pulse",
      )}
      style={{ borderLeftWidth: 8, borderLeftColor: m.color }}
      aria-label={`${m.label}: ${thread.title}`}
      data-testid="hypothesis-card"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button,textarea,a")) return;
        ui.getState().set({ focusHypothesisItemId: focused ? null : id });
      }}
    >
      <header className="card-drag flex cursor-grab items-center gap-2 px-3 pt-2 active:cursor-grabbing">
        <span className="font-mono text-xs font-bold">{m.label}</span>
        <span className="flex-1" />
        {(saving || thread.pending) && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        <StateChip tone={STATUS_TONE[status] ?? "muted"}>
          {t(`caseBoard.hypothesis.status.${status as "PROPOSED"}`)}
        </StateChip>
      </header>

      <div className="px-3 pt-1 pb-2">
        {editing ? (
          <StatementEditor
            initial={thread.title}
            placeholder={t("caseBoard.hypothesis.placeholder")}
            onSave={(draft) => void saveStatement(draft)}
            onCancel={stopEditing}
          />
        ) : (
          <p className="line-clamp-4 text-sm leading-snug font-medium">{thread.title}</p>
        )}
      </div>

      {lod === "full" && (
        <>
          {thread.confidence !== null && (
            <div className="flex items-center gap-2 px-3 pb-1.5 text-[11px] text-muted-foreground">
              <span>{t("caseBoard.hypothesis.confidence")}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full bg-foreground"
                  style={{ width: `${Math.round((thread.confidence ?? 0) * 100)}%` }}
                />
              </span>
              <span className="font-mono">{thread.confidence.toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center gap-3 border-t border-border/60 px-3 py-1.5 text-[11px]">
            <span className="inline-flex items-center gap-0.5" title={t("caseBoard.link.supports")}>
              <Check className="size-3 text-[var(--cb-supports)]" aria-hidden />
              {thread.supportingCount}
            </span>
            <span className="inline-flex items-center gap-0.5" title={t("caseBoard.link.contradicts")}>
              <X className="size-3 text-[var(--cb-contradicts)]" aria-hidden />
              {thread.contradictingCount}
            </span>
            <span className="inline-flex items-center gap-0.5" title={t("caseBoard.link.neutral")}>
              <Circle className="size-2.5 text-[var(--cb-neutral)]" aria-hidden />
              {thread.neutralCount}
            </span>
            <span className="flex-1" />
            <span className="inline-flex min-w-0 items-center gap-1 truncate text-muted-foreground">
              <MessageSquare className="size-3 shrink-0" aria-hidden />
              {thread.entryCount}
              {thread.lastEntryAt && thread.lastAuthor && (
                <span className="truncate">
                  {" · "}
                  {t("caseBoard.hypothesis.lastEntry", {
                    name: thread.lastAuthor,
                    when: formatDistanceToNowStrict(new Date(thread.lastEntryAt), { addSuffix: true }),
                  })}
                </span>
              )}
            </span>
          </div>
          <div className="flex justify-end border-t border-border/60">
            <button
              type="button"
              className="nodrag inline-flex items-center gap-1 px-3 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
              disabled={thread.pending}
              onClick={() => ui.getState().openDrawer("thread", { threadId: thread.id })}
            >
              {t("caseBoard.hypothesis.openThread")}
              <ChevronRight className="size-3" aria-hidden />
            </button>
          </div>
        </>
      )}
      <Ports connectable={!readOnly} />
    </div>
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
