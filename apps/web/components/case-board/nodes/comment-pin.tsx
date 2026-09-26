"use client";

import * as React from "react";
import { type NodeProps } from "@xyflow/react";
import { formatDistanceToNowStrict } from "date-fns";
import { Check, Loader2, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { api, getActorName, type ThreadEntryDto } from "@workspace/api-client";
import { Popover, PopoverAnchor, PopoverContent } from "@workspace/ui/components/popover";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { resolveComment } from "../store/commands";
import type { BoardNode } from "../store/projection";
import { initialsOf } from "../store/selectors";

/**
 * A comment pin (PRD §5.6): a DISCUSSION thread anchored to an item, a finding
 * row or a point. It moves with the item it is pinned to (parentId). Replies
 * go straight to the thread; resolving greys the pin and never deletes it.
 */
export const CommentPin = React.memo(function CommentPin({ id, selected }: NodeProps<BoardNode>) {
  const { t } = useTranslation();
  const item = useBoard((s) => s.items.get(id));
  const thread = useBoard((s) => (item?.refId ? s.threads.get(item.refId) : undefined));
  const readOnly = useBoard((s) => s.readOnly);
  const open = useUi((s) => s.openCommentItemId === id);
  const ui = useUiStore();
  const store = useBoardStore();
  if (!item || !thread) return null;
  const resolved = Boolean(thread.resolvedAt);
  const author = thread.createdBy ?? thread.lastAuthor;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => ui.getState().set({ openCommentItemId: next ? id : null })}
    >
      <PopoverAnchor asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 min-w-8 items-center gap-1 rounded-full rounded-bl-none border-2 px-1.5 font-mono text-[11px] font-bold",
            resolved
              ? "border-border/60 bg-muted text-muted-foreground"
              : "border-foreground bg-background text-foreground",
            selected && "outline outline-2 outline-offset-2 outline-foreground",
          )}
          aria-label={t("caseBoard.comment.pin", { name: author ?? t("caseBoard.someone") })}
          title={thread.lastExcerpt ?? thread.title}
          data-testid="comment-pin"
          onClick={() => ui.getState().set({ openCommentItemId: open ? null : id })}
        >
          <span>{initialsOf(author)}</span>
          {thread.entryCount > 1 && (
            <span className="rounded-full bg-foreground px-1 text-[9px] text-background">
              {thread.entryCount - 1}
            </span>
          )}
          {resolved && <Check className="size-3" aria-hidden />}
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        className="nowheel nodrag w-80 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {open && (
          <CommentThread
            threadId={thread.pending ? null : thread.id}
            fallbackBody={thread.lastExcerpt}
            resolved={resolved}
            readOnly={readOnly}
            onResolve={() => store.getState().run(resolveComment(id, !resolved))}
          />
        )}
      </PopoverContent>
    </Popover>
  );
});

function CommentThread({
  threadId,
  fallbackBody,
  resolved,
  readOnly,
  onResolve,
}: {
  threadId: string | null;
  fallbackBody: string | null;
  resolved: boolean;
  readOnly: boolean;
  onResolve: () => void;
}) {
  const { t } = useTranslation();
  const store = useBoardStore();
  const [entries, setEntries] = React.useState<ThreadEntryDto[] | null>(null);
  const [reply, setReply] = React.useState("");
  const [sending, setSending] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!threadId) return;
    try {
      const res = await api.threads.caseThreadsControllerGetEntries({ id: threadId, limit: "100" });
      setEntries([...res.items].reverse());
    } catch {
      setEntries([]);
    }
  }, [threadId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    const body = reply.trim();
    if (!body || !threadId) return;
    setSending(true);
    try {
      await api.threads.caseThreadsControllerAddEntry({
        id: threadId,
        addThreadEntryDto: { entryType: "NOTE", body, author: getActorName() },
      });
      setReply("");
      await load();
      store.getState().refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex max-h-[420px] flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {resolved ? t("caseBoard.comment.resolved") : t("caseBoard.comment.post")}
        </span>
        {!readOnly && threadId && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onResolve}>
            {resolved ? <RotateCcw className="size-3" /> : <Check className="size-3" />}
            {resolved ? t("caseBoard.comment.reopen") : t("caseBoard.comment.resolve")}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">
        {!threadId || entries === null ? (
          <p className="text-sm">{fallbackBody ?? <Loader2 className="size-4 animate-spin" />}</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="space-y-0.5">
              <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">{entry.author ?? t("caseBoard.someone")}</span>
                <span>{formatDistanceToNowStrict(new Date(entry.createdAt), { addSuffix: true })}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{entry.body}</p>
            </div>
          ))
        )}
      </div>
      {!readOnly && threadId && (
        <div className="flex items-end gap-2 border-t border-border p-2">
          <Textarea
            value={reply}
            rows={2}
            placeholder={t("caseBoard.comment.replyPlaceholder")}
            className="min-h-0 resize-none text-sm"
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button
            size="icon"
            className="size-8 shrink-0"
            aria-label={t("caseBoard.comment.reply")}
            disabled={sending || !reply.trim()}
            onClick={() => void send()}
          >
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          </Button>
        </div>
      )}
    </div>
  );
}
